const express = require('express');
const pool = require('../db');
const { wrap, ok, ApiError, paging, like, num, genOrderNo, writeLog } = require('../utils/helpers');
const { requirePerm } = require('../middleware/auth');

const inboundRouter = express.Router();
const outboundRouter = express.Router();

// ==================== 入库单 ====================
inboundRouter.get('/', requirePerm('stock:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { status, keyword } = req.query;
  const where = ['1=1'];
  const args = [];
  if (status) { where.push('o.status=?'); args.push(status); }
  if (keyword) {
    where.push('(o.order_no LIKE ? OR s.name LIKE ? OR o.remark LIKE ?)');
    const k = like(keyword); args.push(k, k, k);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inbound_order o LEFT JOIN supplier s ON s.id=o.supplier_id ${whereSql}`, args);
  const [list] = await pool.query(
    `SELECT o.*, s.name AS supplier_name, u.real_name AS operator_name, cb.real_name AS confirmer_name,
            (SELECT COUNT(*) FROM inbound_order_item i WHERE i.order_id=o.id) AS item_count
     FROM inbound_order o LEFT JOIN supplier s ON s.id=o.supplier_id
     LEFT JOIN sys_user u ON u.id=o.operator_id
     LEFT JOIN sys_user cb ON cb.id=o.confirmed_by
     ${whereSql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset]);
  ok(res, { list, total, page, pageSize });
}));

inboundRouter.get('/:id', requirePerm('stock:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[order]] = await pool.query(
    `SELECT o.*, s.name AS supplier_name, u.real_name AS operator_name, cb.real_name AS confirmer_name
     FROM inbound_order o LEFT JOIN supplier s ON s.id=o.supplier_id
     LEFT JOIN sys_user u ON u.id=o.operator_id LEFT JOIN sys_user cb ON cb.id=o.confirmed_by
     WHERE o.id=?`, [id]);
  if (!order) throw new ApiError('入库单不存在', 404);
  const [items] = await pool.query(
    `SELECT i.*, c.part_number, c.name, c.brand, c.model, c.unit, c.package
     FROM inbound_order_item i JOIN component c ON c.id=i.component_id WHERE i.order_id=?`, [id]);
  ok(res, { order, items });
}));

inboundRouter.post('/', requirePerm('stock:view'), wrap(async (req, res) => {
  const { type = 'purchase', supplier_id, purchase_order_id, remark, items } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw new ApiError('请添加入库明细');
  for (const it of items) {
    if (!it.component_id || num(it.quantity) <= 0) throw new ApiError('明细中的器件与数量必须有效');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const no = await genOrderNo(conn, 'inbound_order', 'order_no', 'IN');
    const totalQty = items.reduce((a, i) => a + num(i.quantity), 0);
    const totalAmount = items.reduce((a, i) => a + num(i.quantity) * num(i.unit_price), 0);
    const [r] = await conn.query(
      `INSERT INTO inbound_order (order_no,type,purchase_order_id,supplier_id,status,total_qty,total_amount,operator_id,remark)
       VALUES (?,?,?,?,'draft',?,?,?,?)`,
      [no, type, purchase_order_id || null, supplier_id || null, totalQty, totalAmount.toFixed(2), req.user.id, remark || null]);
    await conn.query(
      `INSERT INTO inbound_order_item (order_id,component_id,quantity,unit_price,batch_no,location,expiry_date) VALUES ?`,
      [items.map(i => [r.insertId, i.component_id, num(i.quantity), num(i.unit_price), i.batch_no || null,
        i.location || null, i.expiry_date || null])]);
    await conn.commit();
    await writeLog(req, 'stock', '创建入库单', `${no}，${items.length} 项`);
    ok(res, { id: r.insertId, order_no: no }, '入库单已创建，确认后才会增加库存');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

async function confirmInboundTx(conn, id, userId) {
  const [[order]] = await conn.query('SELECT * FROM inbound_order WHERE id=? FOR UPDATE', [id]);
  if (!order) throw new ApiError('入库单不存在', 404);
  if (order.status !== 'draft') throw new ApiError('仅草稿状态的入库单可确认');

  const [items] = await conn.query('SELECT * FROM inbound_order_item WHERE order_id=?', [id]);
  for (const it of items) {
    let [[st]] = await conn.query('SELECT * FROM stock WHERE component_id=? FOR UPDATE', [it.component_id]);
    if (!st) {
      await conn.query('INSERT INTO stock (component_id,quantity,reserved,in_transit,avg_price) VALUES (?,0,0,0,0)', [it.component_id]);
      [[st]] = await conn.query('SELECT * FROM stock WHERE component_id=? FOR UPDATE', [it.component_id]);
    }
    const before = num(st.quantity);
    const qty = num(it.quantity);
    const price = num(it.unit_price);
    const after = before + qty;
    const avg = after > 0 ? (before * num(st.avg_price) + qty * price) / after : price;
    await conn.query('UPDATE stock SET quantity=?, avg_price=? WHERE component_id=?',
      [after, Number(avg.toFixed(4)), it.component_id]);

    const batchNo = it.batch_no || `B${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(it.component_id).padStart(3, '0')}`;
    const [bat] = await conn.query(
      'SELECT id FROM stock_batch WHERE component_id=? AND batch_no=? LIMIT 1', [it.component_id, batchNo]);
    if (bat) {
      await conn.query('UPDATE stock_batch SET quantity=quantity+?, unit_price=? WHERE id=?', [qty, price, bat.id]);
    } else {
      await conn.query(
        `INSERT INTO stock_batch (component_id,batch_no,quantity,unit_price,location,supplier_id,expiry_date,status)
         VALUES (?,?,?,?,?,?,?,1)`,
        [it.component_id, batchNo, qty, price, it.location || '待分配', order.supplier_id || null, it.expiry_date || null]);
    }
    await conn.query(
      `INSERT INTO stock_transaction (component_id,type,quantity,before_qty,after_qty,ref_type,ref_id,ref_no,batch_no,location,operator_id,remark)
       VALUES (?,?,?,?,?,'inbound',?,?,?,?,?,?)`,
      [it.component_id, 'in', qty, before, after, id, order.order_no, batchNo, it.location || null, userId,
        `入库单 ${order.order_no} 确认`]);

    if (order.purchase_order_id) {
      await conn.query(
        'UPDATE purchase_order_item SET received_qty = received_qty + ? WHERE order_id=? AND component_id=?',
        [qty, order.purchase_order_id, it.component_id]);
      await conn.query('UPDATE stock SET in_transit = GREATEST(0, in_transit - ?) WHERE component_id=?',
        [qty, it.component_id]);
    }
  }

  await conn.query(`UPDATE inbound_order SET status='confirmed', confirmed_by=?, confirmed_at=NOW() WHERE id=?`,
    [userId, id]);

  if (order.purchase_order_id) {
    const [[s]] = await conn.query(
      `SELECT SUM(quantity - received_qty) AS remain FROM purchase_order_item WHERE order_id=?`,
      [order.purchase_order_id]);
    const status = num(s.remain) <= 0 ? 'received' : 'partial';
    await conn.query('UPDATE purchase_order SET status=? WHERE id=?', [status, order.purchase_order_id]);
  }
  return { order, items };
}

/** Excel 智能导入并一键入库 */
inboundRouter.post('/import', requirePerm('stock:confirm'), wrap(async (req, res) => {
  const { type = 'purchase', supplier_id, remark, confirm = true } = req.body || {};
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) throw new ApiError('没有可入库的数据');
  if (items.length > 1000) throw new ApiError('单次最多导入 1000 行');
  for (const it of items) {
    if (!it.component_id || num(it.quantity) <= 0) throw new ApiError('明细中的器件与数量必须有效');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids = [...new Set(items.map(i => num(i.component_id)))];
    const [exists] = await conn.query('SELECT id FROM component WHERE status=1 AND id IN (?)', [ids]);
    if (exists.length !== ids.length) throw new ApiError('存在无效或已停用的器件，请刷新后重试');

    const no = await genOrderNo(conn, 'inbound_order', 'order_no', 'IN');
    const totalQty = items.reduce((a, i) => a + num(i.quantity), 0);
    const totalAmount = items.reduce((a, i) => a + num(i.quantity) * num(i.unit_price), 0);
    const [r] = await conn.query(
      `INSERT INTO inbound_order (order_no,type,supplier_id,status,total_qty,total_amount,operator_id,remark)
       VALUES (?,?,?,'draft',?,?,?,?)`,
      [no, type, supplier_id || null, totalQty, totalAmount.toFixed(2), req.user.id, remark || 'Excel 导入入库']);
    await conn.query(
      `INSERT INTO inbound_order_item (order_id,component_id,quantity,unit_price,batch_no,location,expiry_date)
       VALUES ?`,
      [items.map(i => [r.insertId, num(i.component_id), num(i.quantity), num(i.unit_price),
        i.batch_no || null, i.location || null, i.expiry_date || null])]);

    if (confirm) await confirmInboundTx(conn, r.insertId, req.user.id);
    await conn.commit();
    await writeLog(req, 'stock', confirm ? '导入并入库' : '导入入库单',
      `${no} 共 ${items.length} 项${confirm ? '，已确认入库' : '，待确认'}`);
    ok(res, { id: r.insertId, order_no: no, confirmed: !!confirm, count: items.length, total_qty: totalQty },
      confirm ? `已一键入库 ${no}，共 ${items.length} 项` : `已生成入库单 ${no}，请确认`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

inboundRouter.post('/:id/confirm', requirePerm('stock:confirm'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { order, items } = await confirmInboundTx(conn, id, req.user.id);
    await conn.commit();
    await writeLog(req, 'stock', '确认入库', `${order.order_no} 确认，${items.length} 项`);
    ok(res, null, '入库确认成功，库存已更新');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

inboundRouter.post('/:id/cancel', requirePerm('stock:confirm'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[order]] = await pool.query('SELECT * FROM inbound_order WHERE id=?', [id]);
  if (!order) throw new ApiError('入库单不存在', 404);
  if (order.status !== 'draft') throw new ApiError('仅草稿状态可作废');
  await pool.query(`UPDATE inbound_order SET status='cancelled' WHERE id=?`, [id]);
  await writeLog(req, 'stock', '作废入库单', `${order.order_no} 作废`);
  ok(res, null, '入库单已作废');
}));

// ==================== 出库单 ====================
outboundRouter.get('/', requirePerm('stock:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { status, keyword, type } = req.query;
  const where = ['1=1'];
  const args = [];
  if (status) { where.push('o.status=?'); args.push(status); }
  if (type) { where.push('o.type=?'); args.push(type); }
  if (keyword) {
    where.push('(o.order_no LIKE ? OR o.project LIKE ? OR o.remark LIKE ?)');
    const k = like(keyword); args.push(k, k, k);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM outbound_order o ${whereSql}`, args);
  const [list] = await pool.query(
    `SELECT o.*, u.real_name AS operator_name, cb.real_name AS confirmer_name, b.bom_no, b.name AS bom_name,
            (SELECT COUNT(*) FROM outbound_order_item i WHERE i.order_id=o.id) AS item_count
     FROM outbound_order o LEFT JOIN sys_user u ON u.id=o.operator_id
     LEFT JOIN sys_user cb ON cb.id=o.confirmed_by
     LEFT JOIN bom b ON b.id=o.bom_id
     ${whereSql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset]);
  ok(res, { list, total, page, pageSize });
}));

outboundRouter.get('/:id', requirePerm('stock:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[order]] = await pool.query(
    `SELECT o.*, u.real_name AS operator_name, cb.real_name AS confirmer_name, b.bom_no, b.name AS bom_name
     FROM outbound_order o LEFT JOIN sys_user u ON u.id=o.operator_id
     LEFT JOIN sys_user cb ON cb.id=o.confirmed_by LEFT JOIN bom b ON b.id=o.bom_id
     WHERE o.id=?`, [id]);
  if (!order) throw new ApiError('出库单不存在', 404);
  const [items] = await pool.query(
    `SELECT i.*, c.part_number, c.name, c.brand, c.model, c.unit, c.package,
            COALESCE(s.quantity,0) AS stock_qty, COALESCE(s.reserved,0) AS reserved_qty
     FROM outbound_order_item i JOIN component c ON c.id=i.component_id
     LEFT JOIN stock s ON s.component_id=c.id WHERE i.order_id=?`, [id]);
  ok(res, { order, items });
}));

outboundRouter.post('/', requirePerm('stock:view'), wrap(async (req, res) => {
  const { type = 'production', bom_id, project, remark, items } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw new ApiError('请添加出库明细');
  for (const it of items) {
    if (!it.component_id || num(it.quantity) <= 0) throw new ApiError('明细中的器件与数量必须有效');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const no = await genOrderNo(conn, 'outbound_order', 'order_no', 'OUT');
    const totalQty = items.reduce((a, i) => a + num(i.quantity), 0);
    const [r] = await conn.query(
      `INSERT INTO outbound_order (order_no,type,bom_id,project,status,total_qty,operator_id,remark)
       VALUES (?,?,?,?,'draft',?,?,?)`,
      [no, type, bom_id || null, project || null, totalQty, req.user.id, remark || null]);
    await conn.query(
      'INSERT INTO outbound_order_item (order_id,component_id,quantity,purpose) VALUES ?',
      [items.map(i => [r.insertId, i.component_id, num(i.quantity), i.purpose || project || null])]);
    await conn.commit();
    await writeLog(req, 'stock', '创建出库单', `${no}，${items.length} 项`);
    ok(res, { id: r.insertId, order_no: no }, '出库单已创建，提交后预占库存');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

/** 提交：预占库存，防止其他单据超发 */
outboundRouter.post('/:id/submit', requirePerm('stock:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM outbound_order WHERE id=? FOR UPDATE', [id]);
    if (!order) throw new ApiError('出库单不存在', 404);
    if (order.status !== 'draft') throw new ApiError('仅草稿状态可提交');
    const [items] = await conn.query(
      `SELECT i.*, c.part_number FROM outbound_order_item i JOIN component c ON c.id=i.component_id WHERE i.order_id=?`, [id]);
    for (const it of items) {
      const [[st]] = await conn.query('SELECT * FROM stock WHERE component_id=? FOR UPDATE', [it.component_id]);
      if (!st) throw new ApiError(`器件 ${it.part_number} 无库存记录`);
      const available = num(st.quantity) - num(st.reserved);
      if (available < num(it.quantity)) {
        throw new ApiError(`器件 ${it.part_number} 可用库存不足：可用 ${available}，需 ${it.quantity}`);
      }
      await conn.query('UPDATE stock SET reserved = reserved + ? WHERE component_id=?', [num(it.quantity), it.component_id]);
    }
    await conn.query(`UPDATE outbound_order SET status='pending' WHERE id=?`, [id]);
    await conn.commit();
    await writeLog(req, 'stock', '提交出库单', `${order.order_no} 提交，预占库存`);
    ok(res, null, '已提交，库存已预占');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

/** 确认出库：事务 + 行锁，防并发超发 */
outboundRouter.post('/:id/confirm', requirePerm('stock:confirm'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM outbound_order WHERE id=? FOR UPDATE', [id]);
    if (!order) throw new ApiError('出库单不存在', 404);
    if (!['draft', 'pending'].includes(order.status)) throw new ApiError('当前状态不可确认');

    const [items] = await conn.query(
      `SELECT i.*, c.part_number FROM outbound_order_item i JOIN component c ON c.id=i.component_id WHERE i.order_id=?`, [id]);
    for (const it of items) {
      const [[st]] = await conn.query('SELECT * FROM stock WHERE component_id=? FOR UPDATE', [it.component_id]);
      if (!st) throw new ApiError(`器件 ${it.part_number} 无库存记录`);
      const qty = num(it.quantity);
      const reserved = num(st.reserved);
      if (order.status === 'pending') {
        if (num(st.quantity) < qty) {
          throw new ApiError(`器件 ${it.part_number} 库存不足：现有 ${st.quantity}，需 ${qty}`);
        }
        await conn.query('UPDATE stock SET quantity = quantity - ?, reserved = GREATEST(0, reserved - ?) WHERE component_id=?',
          [qty, qty, it.component_id]);
      } else {
        const available = num(st.quantity) - reserved;
        if (available < qty) {
          throw new ApiError(`器件 ${it.part_number} 可用库存不足：可用 ${available}，需 ${qty}`);
        }
        await conn.query('UPDATE stock SET quantity = quantity - ? WHERE component_id=?', [qty, it.component_id]);
      }
      await conn.query(
        `INSERT INTO stock_transaction (component_id,type,quantity,before_qty,after_qty,ref_type,ref_id,ref_no,operator_id,remark)
         VALUES (?,?,?,?,?,'outbound',?,?,?,?)`,
        [it.component_id, 'out', -qty, num(st.quantity), num(st.quantity) - qty, id, order.order_no,
          req.user.id, `出库单 ${order.order_no} 确认`]);
    }
    await conn.query(`UPDATE outbound_order SET status='confirmed', confirmed_by=?, confirmed_at=NOW() WHERE id=?`,
      [req.user.id, id]);
    await conn.commit();
    await writeLog(req, 'stock', '确认出库', `${order.order_no} 确认，${items.length} 项`);
    ok(res, null, '出库确认成功，库存已扣减');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

outboundRouter.post('/:id/cancel', requirePerm('stock:confirm'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM outbound_order WHERE id=? FOR UPDATE', [id]);
    if (!order) throw new ApiError('出库单不存在', 404);
    if (!['draft', 'pending'].includes(order.status)) throw new ApiError('当前状态不可作废');
    if (order.status === 'pending') {
      const [items] = await conn.query('SELECT * FROM outbound_order_item WHERE order_id=?', [id]);
      for (const it of items) {
        await conn.query('UPDATE stock SET reserved = GREATEST(0, reserved - ?) WHERE component_id=?',
          [num(it.quantity), it.component_id]);
      }
    }
    await conn.query(`UPDATE outbound_order SET status='cancelled' WHERE id=?`, [id]);
    await conn.commit();
    await writeLog(req, 'stock', '作废出库单', `${order.order_no} 作废`);
    ok(res, null, '出库单已作废，预占已释放');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = { inboundRouter, outboundRouter };
