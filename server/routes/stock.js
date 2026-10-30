const express = require('express');
const pool = require('../db');
const { wrap, ok, ApiError, paging, like, num, genOrderNo, writeLog } = require('../utils/helpers');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();

router.get('/', requirePerm('stock:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { keyword, category_id, only_warning } = req.query;
  const where = ['c.status = 1'];
  const args = [];
  if (keyword) {
    where.push('(c.part_number LIKE ? OR c.name LIKE ? OR c.model LIKE ? OR c.brand LIKE ?)');
    const k = like(keyword);
    args.push(k, k, k, k);
  }
  if (category_id) { where.push('c.category_id = ?'); args.push(category_id); }
  if (String(only_warning) === '1') where.push('s.quantity < c.min_stock');
  const whereSql = 'WHERE ' + where.join(' AND ');

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM stock s JOIN component c ON c.id=s.component_id ${whereSql}`, args);

  const [list] = await pool.query(
    `SELECT c.id AS component_id, c.part_number, c.name, c.brand, c.model, c.package, c.unit,
            c.min_stock, c.lifecycle, cat.name AS category_name,
            s.quantity, s.reserved, s.in_transit, s.avg_price,
            ROUND(s.quantity - s.reserved, 3) AS available,
            ROUND(s.quantity * s.avg_price, 2) AS stock_value,
            CASE WHEN s.quantity < c.min_stock THEN 1 ELSE 0 END AS warning
     FROM stock s JOIN component c ON c.id=s.component_id
     LEFT JOIN category cat ON cat.id=c.category_id
     ${whereSql}
     ORDER BY warning DESC, s.quantity ASC
     LIMIT ? OFFSET ?`, [...args, pageSize, offset]);

  const [[stats]] = await pool.query(`
    SELECT COUNT(*) AS sku,
           SUM(CASE WHEN s.quantity < c.min_stock THEN 1 ELSE 0 END) AS warning,
           SUM(CASE WHEN s.quantity <= 0 THEN 1 ELSE 0 END) AS zero,
           SUM(s.quantity) AS total_qty,
           ROUND(SUM(s.quantity * s.avg_price),2) AS total_value,
           ROUND(SUM(s.in_transit * s.avg_price),2) AS transit_value
    FROM stock s JOIN component c ON c.id=s.component_id WHERE c.status=1`);

  ok(res, { list, total, page, pageSize, stats });
}));

router.get('/transactions', requirePerm('stock:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { keyword, type, start, end, component_id } = req.query;
  const where = ['1=1'];
  const args = [];
  if (component_id) { where.push('t.component_id=?'); args.push(component_id); }
  if (keyword) {
    where.push('(c.part_number LIKE ? OR c.name LIKE ? OR t.ref_no LIKE ?)');
    const k = like(keyword); args.push(k, k, k);
  }
  if (type) { where.push('t.type=?'); args.push(type); }
  if (start) { where.push('t.created_at >= ?'); args.push(start + ' 00:00:00'); }
  if (end) { where.push('t.created_at <= ?'); args.push(end + ' 23:59:59'); }
  const whereSql = 'WHERE ' + where.join(' AND ');

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM stock_transaction t JOIN component c ON c.id=t.component_id ${whereSql}`, args);
  const [list] = await pool.query(
    `SELECT t.*, c.part_number, c.name AS component_name, c.unit, u.real_name AS operator_name
     FROM stock_transaction t JOIN component c ON c.id=t.component_id
     LEFT JOIN sys_user u ON u.id=t.operator_id
     ${whereSql} ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, offset]);

  const [[stats]] = await pool.query(
    `SELECT SUM(CASE WHEN t.quantity>0 THEN t.quantity ELSE 0 END) AS in_qty,
            SUM(CASE WHEN t.quantity<0 THEN -t.quantity ELSE 0 END) AS out_qty,
            COUNT(*) AS cnt
     FROM stock_transaction t JOIN component c ON c.id=t.component_id ${whereSql}`, args);

  ok(res, { list, total, page, pageSize, stats });
}));

router.post('/adjust', requirePerm('stock:adjust'), wrap(async (req, res) => {
  const { component_id, quantity, remark } = req.body || {};
  const delta = num(quantity);
  if (!component_id || !delta) throw new ApiError('请选择器件并填写调整数量');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[st]] = await conn.query('SELECT * FROM stock WHERE component_id=? FOR UPDATE', [component_id]);
    if (!st) throw new ApiError('库存记录不存在', 404);
    const after = num(st.quantity) + delta;
    if (after < 0) throw new ApiError(`调整后库存为负（现有 ${st.quantity}），请核对`);
    await conn.query('UPDATE stock SET quantity=? WHERE component_id=?', [after, component_id]);
    const orderNo = await genOrderNo(conn, 'stock_transaction', 'ref_no', 'ADJ');
    await conn.query(
      `INSERT INTO stock_transaction (component_id,type,quantity,before_qty,after_qty,ref_type,ref_no,operator_id,remark)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [component_id, 'adjust', delta, st.quantity, after, 'manual', orderNo, req.user.id, remark || '手工库存调整']);
    await conn.commit();
    await writeLog(req, 'stock', '库存调整', `器件 ${component_id} 调整 ${delta > 0 ? '+' : ''}${delta}，${st.quantity} → ${after}`);
    ok(res, { quantity: after }, '库存调整成功');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// ---------- 盘点 ----------
router.get('/checks', requirePerm('stock:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM stock_check');
  const [list] = await pool.query(
    `SELECT ck.*, u.real_name AS operator_name FROM stock_check ck
     LEFT JOIN sys_user u ON u.id=ck.operator_id
     ORDER BY ck.created_at DESC LIMIT ? OFFSET ?`, [pageSize, offset]);
  ok(res, { list, total, page, pageSize });
}));

router.post('/checks', requirePerm('stock:check'), wrap(async (req, res) => {
  const { scope, category_id, remark } = req.body || {};
  if (!scope) throw new ApiError('请填写盘点范围');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const checkNo = await genOrderNo(conn, 'stock_check', 'check_no', 'CK');
    const [r] = await conn.query(
      `INSERT INTO stock_check (check_no,scope,status,operator_id,remark) VALUES (?,?,'in_progress',?,?)`,
      [checkNo, scope, req.user.id, remark || null]);
    const where = category_id ? 'WHERE c.category_id=? AND c.status=1' : 'WHERE c.status=1';
    const args = category_id ? [category_id] : [];
    const [rows] = await conn.query(
      `SELECT c.id, s.quantity FROM component c JOIN stock s ON s.component_id=c.id ${where}`, args);
    if (!rows.length) throw new ApiError('该范围内没有可盘点的器件');
    await conn.query(
      'INSERT INTO stock_check_item (check_id,component_id,book_qty,actual_qty,diff_qty) VALUES ?',
      [rows.map(r2 => [r.insertId, r2.id, r2.quantity, r2.quantity, 0])]);
    await conn.query('UPDATE stock_check SET item_count=? WHERE id=?', [rows.length, r.insertId]);
    await conn.commit();
    await writeLog(req, 'stock', '新建盘点', `${checkNo} ${scope}，共 ${rows.length} 项`);
    ok(res, { id: r.insertId, check_no: checkNo }, '盘点单已创建');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

router.get('/checks/:id', requirePerm('stock:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[check]] = await pool.query(
    `SELECT ck.*, u.real_name AS operator_name FROM stock_check ck
     LEFT JOIN sys_user u ON u.id=ck.operator_id WHERE ck.id=?`, [id]);
  if (!check) throw new ApiError('盘点单不存在', 404);
  const [items] = await pool.query(
    `SELECT ci.*, c.part_number, c.name, c.model, c.brand, c.unit, c.package
     FROM stock_check_item ci JOIN component c ON c.id=ci.component_id
     WHERE ci.check_id=? ORDER BY c.part_number`, [id]);
  ok(res, { check, items });
}));

router.put('/checks/:id/items', requirePerm('stock:check'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const [[check]] = await pool.query('SELECT * FROM stock_check WHERE id=?', [id]);
  if (!check) throw new ApiError('盘点单不存在', 404);
  if (check.status === 'done') throw new ApiError('盘点单已完成，不可修改');
  for (const it of items) {
    const actual = num(it.actual_qty);
    if (actual < 0) throw new ApiError('实盘数量不能为负');
    await pool.query(
      'UPDATE stock_check_item SET actual_qty=?, diff_qty=? WHERE id=? AND check_id=?',
      [actual, actual - num(it.book_qty), num(it.id), id]);
  }
  const [[d]] = await pool.query(
    'SELECT COUNT(*) AS n FROM stock_check_item WHERE check_id=? AND diff_qty<>0', [id]);
  await pool.query('UPDATE stock_check SET diff_count=? WHERE id=?', [d.n, id]);
  ok(res, { diff_count: d.n }, '盘点数据已保存');
}));

router.post('/checks/:id/finish', requirePerm('stock:check'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[check]] = await conn.query('SELECT * FROM stock_check WHERE id=? FOR UPDATE', [id]);
    if (!check) throw new ApiError('盘点单不存在', 404);
    if (check.status === 'done') throw new ApiError('盘点单已完成');
    const [items] = await conn.query('SELECT * FROM stock_check_item WHERE check_id=?', [id]);
    let adjusted = 0;
    for (const it of items) {
      const diff = num(it.diff_qty);
      if (!diff) continue;
      const [[st]] = await conn.query('SELECT quantity FROM stock WHERE component_id=? FOR UPDATE', [it.component_id]);
      const before = num(st.quantity);
      const after = before + diff;
      if (after < 0) throw new ApiError(`器件 ID ${it.component_id} 盘亏数量超过现有库存`);
      await conn.query('UPDATE stock SET quantity=? WHERE component_id=?', [after, it.component_id]);
      await conn.query(
        `INSERT INTO stock_transaction (component_id,type,quantity,before_qty,after_qty,ref_type,ref_id,ref_no,operator_id,remark)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [it.component_id, 'adjust', diff, before, after, 'stock_check', id, check.check_no, req.user.id, '盘点差异调整']);
      adjusted++;
    }
    await conn.query(
      `UPDATE stock_check SET status='done', finished_at=NOW(), diff_count=? WHERE id=?`, [adjusted, id]);
    await conn.commit();
    await writeLog(req, 'stock', '完成盘点', `${check.check_no} 完成，调整 ${adjusted} 项`);
    ok(res, { adjusted }, `盘点完成，已调整 ${adjusted} 项差异`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = router;
