const express = require('express');
const pool = require('../db');
const { wrap, ok, ApiError, paging, like, num, genOrderNo, writeLog } = require('../utils/helpers');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();

// ==================== 采购申请 ====================
router.get('/requests', requirePerm('purchase:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { status, keyword } = req.query;
  const where = ['1=1'];
  const args = [];
  if (status) { where.push('pr.status=?'); args.push(status); }
  if (keyword) {
    where.push('(pr.request_no LIKE ? OR pr.title LIKE ?)');
    const k = like(keyword); args.push(k, k);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM purchase_request pr ${whereSql}`, args);
  const [list] = await pool.query(
    `SELECT pr.*, u.real_name AS applicant_name, a.real_name AS approver_name,
            (SELECT COUNT(*) FROM purchase_request_item i WHERE i.request_id=pr.id) AS item_count,
            (SELECT COALESCE(SUM(i.quantity),0) FROM purchase_request_item i WHERE i.request_id=pr.id) AS total_qty
     FROM purchase_request pr
     LEFT JOIN sys_user u ON u.id=pr.applicant_id
     LEFT JOIN sys_user a ON a.id=pr.approver_id
     ${whereSql} ORDER BY pr.created_at DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset]);
  ok(res, { list, total, page, pageSize });
}));

router.get('/requests/:id', requirePerm('purchase:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[pr]] = await pool.query(
    `SELECT pr.*, u.real_name AS applicant_name, a.real_name AS approver_name
     FROM purchase_request pr LEFT JOIN sys_user u ON u.id=pr.applicant_id
     LEFT JOIN sys_user a ON a.id=pr.approver_id WHERE pr.id=?`, [id]);
  if (!pr) throw new ApiError('采购申请不存在', 404);
  const [items] = await pool.query(
    `SELECT i.*, c.part_number, c.name, c.brand, c.model, c.package, c.unit,
            COALESCE(s.quantity,0) AS stock_qty, c.min_stock
     FROM purchase_request_item i JOIN component c ON c.id=i.component_id
     LEFT JOIN stock s ON s.component_id=c.id WHERE i.request_id=?`, [id]);
  const [orders] = await pool.query('SELECT id,order_no,status,total_amount,supplier_id FROM purchase_order WHERE request_id=?', [id]);
  ok(res, { request: pr, items, orders });
}));

router.post('/requests', requirePerm('purchase:create'), wrap(async (req, res) => {
  const { title, remark, items } = req.body || {};
  if (!title) throw new ApiError('请填写申请标题');
  if (!Array.isArray(items) || !items.length) throw new ApiError('请至少添加一个采购器件');
  for (const it of items) {
    if (!it.component_id || num(it.quantity) <= 0) throw new ApiError('采购明细的器件与数量必须有效');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const no = await genOrderNo(conn, 'purchase_request', 'request_no', 'PR');
    const [r] = await conn.query(
      `INSERT INTO purchase_request (request_no,source,title,status,applicant_id,remark)
       VALUES (?,'manual',?,'draft',?,?)`, [no, title, req.user.id, remark || null]);
    await conn.query('INSERT INTO purchase_request_item (request_id,component_id,quantity,remark) VALUES ?',
      [items.map(i => [r.insertId, i.component_id, num(i.quantity), i.remark || null])]);
    await conn.commit();
    await writeLog(req, 'purchase', '创建申请', `创建 ${no}，${items.length} 项`);
    ok(res, { id: r.insertId, request_no: no }, '采购申请已创建');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

router.post('/requests/:id/submit', requirePerm('purchase:create'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[pr]] = await pool.query('SELECT * FROM purchase_request WHERE id=?', [id]);
  if (!pr) throw new ApiError('采购申请不存在', 404);
  if (pr.status !== 'draft') throw new ApiError('仅草稿状态可提交');
  await pool.query(`UPDATE purchase_request SET status='pending' WHERE id=?`, [id]);
  await writeLog(req, 'purchase', '提交申请', `${pr.request_no} 提交审批`);
  ok(res, null, '已提交审批');
}));

router.post('/requests/:id/approve', requirePerm('purchase:approve'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const approve = req.body?.approve !== false;
  const [[pr]] = await pool.query('SELECT * FROM purchase_request WHERE id=?', [id]);
  if (!pr) throw new ApiError('采购申请不存在', 404);
  if (pr.status !== 'pending') throw new ApiError('仅待审批状态可操作');
  await pool.query(
    `UPDATE purchase_request SET status=?, approver_id=?, approved_at=NOW(), approve_remark=? WHERE id=?`,
    [approve ? 'approved' : 'rejected', req.user.id, req.body?.remark || null, id]);
  await writeLog(req, 'purchase', approve ? '审批通过' : '审批驳回', `${pr.request_no} ${approve ? '通过' : '驳回'}`);
  ok(res, null, approve ? '审批已通过' : '已驳回');
}));

/** 按主供应商拆分生成采购订单 */
router.post('/requests/:id/to-orders', requirePerm('purchase:order'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[pr]] = await pool.query('SELECT * FROM purchase_request WHERE id=?', [id]);
  if (!pr) throw new ApiError('采购申请不存在', 404);
  if (pr.status !== 'approved') throw new ApiError('仅已审批的申请可生成采购订单');

  const [items] = await pool.query(
    `SELECT i.*, c.avg_price,
            (SELECT cs.supplier_id FROM component_supplier cs WHERE cs.component_id=i.component_id
              ORDER BY cs.is_primary DESC, cs.price ASC LIMIT 1) AS supplier_id,
            (SELECT cs.price FROM component_supplier cs WHERE cs.component_id=i.component_id
              ORDER BY cs.is_primary DESC, cs.price ASC LIMIT 1) AS price
     FROM purchase_request_item i
     LEFT JOIN stock c ON c.component_id=i.component_id
     WHERE i.request_id=?`, [id]);
  if (!items.length) throw new ApiError('申请没有明细');

  const groups = new Map();
  for (const it of items) {
    const key = it.supplier_id || 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const created = [];
    for (const [supplierId, list] of groups) {
      const no = await genOrderNo(conn, 'purchase_order', 'order_no', 'PO');
      const [r] = await conn.query(
        `INSERT INTO purchase_order (order_no,supplier_id,request_id,status,expected_date,created_by,remark)
         VALUES (?,?,?,'draft',DATE_ADD(CURDATE(), INTERVAL 14 DAY),?,?)`,
        [no, supplierId || null, id, req.user.id, `由 ${pr.request_no} 拆分生成`]);
      const rows = list.map(it => [
        r.insertId, it.component_id, num(it.quantity), 0,
        num(it.price, num(it.avg_price, 0))]);
      await conn.query('INSERT INTO purchase_order_item (order_id,component_id,quantity,received_qty,unit_price) VALUES ?', [rows]);
      const total = rows.reduce((a, x) => a + x[2] * x[4], 0);
      await conn.query('UPDATE purchase_order SET total_amount=? WHERE id=?', [total.toFixed(2), r.insertId]);
      created.push({ id: r.insertId, order_no: no, supplier_id: supplierId, items: rows.length, total_amount: Number(total.toFixed(2)) });
    }
    await conn.query(`UPDATE purchase_request SET status='ordered' WHERE id=?`, [id]);
    await conn.commit();
    await writeLog(req, 'purchase', '生成订单', `${pr.request_no} 拆分为 ${created.length} 张采购订单`);
    ok(res, { orders: created }, `已生成 ${created.length} 张采购订单`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

router.delete('/requests/:id', requirePerm('purchase:create'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[pr]] = await pool.query('SELECT * FROM purchase_request WHERE id=?', [id]);
  if (!pr) throw new ApiError('采购申请不存在', 404);
  if (!['draft', 'rejected'].includes(pr.status)) throw new ApiError('仅草稿或已驳回的申请可删除');
  await pool.query('DELETE FROM purchase_request WHERE id=?', [id]);
  await writeLog(req, 'purchase', '删除申请', `删除 ${pr.request_no}`);
  ok(res, null, '已删除');
}));

// ==================== 采购订单 ====================
router.get('/orders', requirePerm('purchase:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { status, keyword } = req.query;
  const where = ['1=1'];
  const args = [];
  if (status) { where.push('o.status=?'); args.push(status); }
  if (keyword) {
    where.push('(o.order_no LIKE ? OR s.name LIKE ?)');
    const k = like(keyword); args.push(k, k);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM purchase_order o LEFT JOIN supplier s ON s.id=o.supplier_id ${whereSql}`, args);
  const [list] = await pool.query(
    `SELECT o.*, s.name AS supplier_name, u.real_name AS creator_name,
            (SELECT COUNT(*) FROM purchase_order_item i WHERE i.order_id=o.id) AS item_count,
            (SELECT COALESCE(SUM(i.quantity),0) FROM purchase_order_item i WHERE i.order_id=o.id) AS total_qty,
            (SELECT COALESCE(SUM(i.received_qty),0) FROM purchase_order_item i WHERE i.order_id=o.id) AS received_qty
     FROM purchase_order o LEFT JOIN supplier s ON s.id=o.supplier_id
     LEFT JOIN sys_user u ON u.id=o.created_by
     ${whereSql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset]);
  ok(res, { list, total, page, pageSize });
}));

router.get('/orders/:id', requirePerm('purchase:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[order]] = await pool.query(
    `SELECT o.*, s.name AS supplier_name, u.real_name AS creator_name
     FROM purchase_order o LEFT JOIN supplier s ON s.id=o.supplier_id
     LEFT JOIN sys_user u ON u.id=o.created_by WHERE o.id=?`, [id]);
  if (!order) throw new ApiError('采购订单不存在', 404);
  const [items] = await pool.query(
    `SELECT i.*, c.part_number, c.name, c.brand, c.model, c.unit, c.package,
            COALESCE(st.quantity,0) AS stock_qty
     FROM purchase_order_item i JOIN component c ON c.id=i.component_id
     LEFT JOIN stock st ON st.component_id=c.id WHERE i.order_id=?`, [id]);
  ok(res, { order, items });
}));

router.post('/orders', requirePerm('purchase:order'), wrap(async (req, res) => {
  const { supplier_id, expected_date, remark, items } = req.body || {};
  if (!supplier_id) throw new ApiError('请选择供应商');
  if (!Array.isArray(items) || !items.length) throw new ApiError('请添加采购明细');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const no = await genOrderNo(conn, 'purchase_order', 'order_no', 'PO');
    const [r] = await conn.query(
      `INSERT INTO purchase_order (order_no,supplier_id,status,total_amount,expected_date,created_by,remark)
       VALUES (?,?,'draft',0,?,?,?)`,
      [no, supplier_id, expected_date || null, req.user.id, remark || null]);
    const rows = items.map(i => [r.insertId, i.component_id, num(i.quantity), 0, num(i.unit_price)]);
    await conn.query('INSERT INTO purchase_order_item (order_id,component_id,quantity,received_qty,unit_price) VALUES ?', [rows]);
    const total = rows.reduce((a, x) => a + x[2] * x[4], 0);
    await conn.query('UPDATE purchase_order SET total_amount=? WHERE id=?', [total.toFixed(2), r.insertId]);
    await conn.commit();
    await writeLog(req, 'purchase', '创建订单', `创建 ${no}，${items.length} 项`);
    ok(res, { id: r.insertId, order_no: no }, '采购订单已创建');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

router.post('/orders/:id/send', requirePerm('purchase:order'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM purchase_order WHERE id=? FOR UPDATE', [id]);
    if (!order) throw new ApiError('采购订单不存在', 404);
    if (!['draft', 'pending', 'approved'].includes(order.status)) throw new ApiError('当前状态不可下发');
    const [items] = await conn.query('SELECT * FROM purchase_order_item WHERE order_id=?', [id]);
    for (const it of items) {
      const remain = num(it.quantity) - num(it.received_qty);
      if (remain > 0) {
        await conn.query(
          'UPDATE stock SET in_transit = in_transit + ? WHERE component_id=?', [remain, it.component_id]);
      }
    }
    await conn.query(`UPDATE purchase_order SET status='sent', sent_at=NOW() WHERE id=?`, [id]);
    await conn.commit();
    await writeLog(req, 'purchase', '下发订单', `${order.order_no} 下发，在途库存增加`);
    ok(res, null, '订单已下发，在途库存已更新');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

/** 收货：生成入库单（草稿），确认入库后扣减在途 */
router.post('/orders/:id/receive', requirePerm('stock:confirm'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM purchase_order WHERE id=? FOR UPDATE', [id]);
    if (!order) throw new ApiError('采购订单不存在', 404);
    if (!['sent', 'partial'].includes(order.status)) throw new ApiError('仅已下发或部分到货的订单可收货');
    const [items] = await conn.query('SELECT * FROM purchase_order_item WHERE order_id=?', [id]);
    const remain = items.filter(i => num(i.quantity) - num(i.received_qty) > 0);
    if (!remain.length) throw new ApiError('该订单已全部到货');

    const no = await genOrderNo(conn, 'inbound_order', 'order_no', 'IN');
    const [r] = await conn.query(
      `INSERT INTO inbound_order (order_no,type,purchase_order_id,supplier_id,status,total_qty,total_amount,operator_id,remark)
       VALUES (?,'purchase',?,?,'draft',0,0,?,?)`,
      [no, id, order.supplier_id, req.user.id, `采购订单 ${order.order_no} 到货`]);
    await conn.query(
      `INSERT INTO inbound_order_item (order_id,component_id,quantity,unit_price,batch_no,location)
       VALUES ?`,
      [remain.map(i => [r.insertId, i.component_id, num(i.quantity) - num(i.received_qty), num(i.unit_price),
        `B${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(i.component_id).padStart(2, '0')}`, null])]);
    const totalQty = remain.reduce((a, i) => a + (num(i.quantity) - num(i.received_qty)), 0);
    const totalAmount = remain.reduce((a, i) => a + (num(i.quantity) - num(i.received_qty)) * num(i.unit_price), 0);
    await conn.query('UPDATE inbound_order SET total_qty=?, total_amount=? WHERE id=?',
      [totalQty, totalAmount.toFixed(2), r.insertId]);
    await conn.commit();
    await writeLog(req, 'purchase', '收货', `${order.order_no} 生成入库单 ${no}`);
    ok(res, { inbound_id: r.insertId, order_no: no }, `已生成入库单 ${no}，请到出入库确认`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

router.post('/orders/:id/cancel', requirePerm('purchase:order'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM purchase_order WHERE id=? FOR UPDATE', [id]);
    if (!order) throw new ApiError('采购订单不存在', 404);
    if (['received', 'cancelled'].includes(order.status)) throw new ApiError('该订单不可取消');
    if (order.status === 'sent' || order.status === 'partial') {
      const [items] = await conn.query('SELECT * FROM purchase_order_item WHERE order_id=?', [id]);
      for (const it of items) {
        const remain = num(it.quantity) - num(it.received_qty);
        if (remain > 0) {
          await conn.query(
            'UPDATE stock SET in_transit = GREATEST(0, in_transit - ?) WHERE component_id=?', [remain, it.component_id]);
        }
      }
    }
    await conn.query(`UPDATE purchase_order SET status='cancelled' WHERE id=?`, [id]);
    await conn.commit();
    await writeLog(req, 'purchase', '取消订单', `${order.order_no} 取消`);
    ok(res, null, '订单已取消');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = router;
