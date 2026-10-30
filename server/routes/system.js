const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { wrap, ok, ApiError, paging, like, num, writeLog } = require('../utils/helpers');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();
const ROLES = ['super_admin', 'admin', 'employee'];

// ==================== 用户 ====================
router.get('/users', requirePerm('sys:user:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { keyword, role, status } = req.query;
  const where = ['1=1'];
  const args = [];
  if (keyword) {
    where.push('(username LIKE ? OR real_name LIKE ? OR dept LIKE ?)');
    const k = like(keyword); args.push(k, k, k);
  }
  if (role) { where.push('role=?'); args.push(role); }
  if (status !== undefined && status !== '') { where.push('status=?'); args.push(num(status)); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM sys_user ${whereSql}`, args);
  const [list] = await pool.query(
    `SELECT id,username,real_name,role,dept,email,phone,status,last_login_at,created_at
     FROM sys_user ${whereSql} ORDER BY FIELD(role,'super_admin','admin','employee'), id LIMIT ? OFFSET ?`,
    [...args, pageSize, offset]);
  ok(res, { list, total, page, pageSize });
}));

router.post('/users', requirePerm('sys:user'), wrap(async (req, res) => {
  const { username, password, real_name, role = 'employee', dept, email, phone } = req.body || {};
  if (!username || !password) throw new ApiError('账号与初始密码必填');
  if (String(password).length < 6) throw new ApiError('密码至少 6 位');
  if (!ROLES.includes(role)) throw new ApiError('角色不合法');
  const [[dup]] = await pool.query('SELECT id FROM sys_user WHERE username=?', [username]);
  if (dup) throw new ApiError('登录账号已存在');
  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.query(
    'INSERT INTO sys_user (username,password_hash,real_name,role,dept,email,phone) VALUES (?,?,?,?,?,?,?)',
    [username, hash, real_name || username, role, dept || null, email || null, phone || null]);
  await writeLog(req, 'system', '新增用户', `新增 ${username}（${role}）`);
  ok(res, { id: r.insertId }, '用户创建成功');
}));

router.put('/users/:id', requirePerm('sys:user'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const b = req.body || {};
  const [[user]] = await pool.query('SELECT * FROM sys_user WHERE id=?', [id]);
  if (!user) throw new ApiError('用户不存在', 404);
  if (b.role && !ROLES.includes(b.role)) throw new ApiError('角色不合法');
  if (user.role === 'super_admin' && b.role && b.role !== 'super_admin') {
    const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM sys_user WHERE role='super_admin' AND status=1");
    if (n.n <= 1) throw new ApiError('系统必须保留至少一个超级管理员');
  }
  await pool.query(
    `UPDATE sys_user SET real_name=COALESCE(?,real_name), role=COALESCE(?,role), dept=?,
       email=?, phone=?, status=COALESCE(?,status) WHERE id=?`,
    [b.real_name ?? null, b.role || null, b.dept ?? null, b.email ?? null, b.phone ?? null,
      b.status === undefined ? null : num(b.status), id]);
  await writeLog(req, 'system', '修改用户', `修改用户 ${user.username} 的信息`);
  ok(res, null, '保存成功');
}));

router.post('/users/:id/reset-password', requirePerm('sys:user'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const password = String(req.body?.password || '');
  if (password.length < 6) throw new ApiError('新密码至少 6 位');
  const [[user]] = await pool.query('SELECT username FROM sys_user WHERE id=?', [id]);
  if (!user) throw new ApiError('用户不存在', 404);
  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE sys_user SET password_hash=? WHERE id=?', [hash, id]);
  await writeLog(req, 'system', '重置密码', `重置用户 ${user.username} 的登录密码`);
  ok(res, null, '密码已重置');
}));

router.delete('/users/:id', requirePerm('sys:user'), wrap(async (req, res) => {
  const id = num(req.params.id);
  if (id === req.user.id) throw new ApiError('不能停用当前登录账号');
  const [[user]] = await pool.query('SELECT * FROM sys_user WHERE id=?', [id]);
  if (!user) throw new ApiError('用户不存在', 404);
  if (user.role === 'super_admin') {
    const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM sys_user WHERE role='super_admin' AND status=1");
    if (n.n <= 1) throw new ApiError('系统必须保留至少一个超级管理员');
  }
  await pool.query('UPDATE sys_user SET status=0 WHERE id=?', [id]);
  await writeLog(req, 'system', '停用用户', `停用用户 ${user.username}`);
  ok(res, null, '用户已停用');
}));

// ==================== 操作日志 ====================
router.get('/logs', requirePerm('sys:log'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { keyword, module, start, end } = req.query;
  const where = ['1=1'];
  const args = [];
  if (keyword) {
    where.push('(username LIKE ? OR detail LIKE ? OR action LIKE ?)');
    const k = like(keyword); args.push(k, k, k);
  }
  if (module) { where.push('module=?'); args.push(module); }
  if (start) { where.push('created_at >= ?'); args.push(start + ' 00:00:00'); }
  if (end) { where.push('created_at <= ?'); args.push(end + ' 23:59:59'); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM operation_log ${whereSql}`, args);
  const [list] = await pool.query(
    `SELECT * FROM operation_log ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, offset]);
  const [modules] = await pool.query('SELECT DISTINCT module FROM operation_log ORDER BY module');
  ok(res, { list, total, page, pageSize, modules: modules.map(m => m.module) });
}));

// ==================== 供应商 ====================
router.get('/suppliers', requirePerm('comp:view'), wrap(async (req, res) => {
  const { keyword } = req.query;
  const where = ['1=1'];
  const args = [];
  if (keyword) {
    where.push('(name LIKE ? OR code LIKE ? OR contact LIKE ?)');
    const k = like(keyword); args.push(k, k, k);
  }
  const [list] = await pool.query(
    `SELECT s.*, (SELECT COUNT(*) FROM component_supplier cs WHERE cs.supplier_id=s.id) AS component_count,
            (SELECT COALESCE(SUM(o.total_amount),0) FROM purchase_order o WHERE o.supplier_id=s.id AND o.status<>'cancelled') AS purchase_amount
     FROM supplier s WHERE ${where.join(' AND ')} ORDER BY s.id`, args);
  ok(res, { list, total: list.length });
}));

router.post('/suppliers', requirePerm('sys:master'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) throw new ApiError('供应商名称必填');
  const code = b.code || 'SUP-' + String(Date.now()).slice(-6);
  const [r] = await pool.query(
    `INSERT INTO supplier (code,name,contact,phone,email,address,rating,remark) VALUES (?,?,?,?,?,?,?,?)`,
    [code, b.name, b.contact || null, b.phone || null, b.email || null, b.address || null, num(b.rating, 3), b.remark || null]);
  await writeLog(req, 'system', '新增供应商', `新增供应商 ${b.name}`);
  ok(res, { id: r.insertId, code }, '供应商已创建');
}));

router.put('/suppliers/:id', requirePerm('sys:master'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const b = req.body || {};
  await pool.query(
    `UPDATE supplier SET name=COALESCE(?,name), contact=?, phone=?, email=?, address=?, rating=COALESCE(?,rating),
       remark=?, status=COALESCE(?,status) WHERE id=?`,
    [b.name || null, b.contact ?? null, b.phone ?? null, b.email ?? null, b.address ?? null,
      b.rating ?? null, b.remark ?? null, b.status === undefined ? null : num(b.status), id]);
  await writeLog(req, 'system', '编辑供应商', `编辑供应商 ID ${id}`);
  ok(res, null, '保存成功');
}));

router.delete('/suppliers/:id', requirePerm('sys:master'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[used]] = await pool.query('SELECT COUNT(*) AS n FROM component_supplier WHERE supplier_id=?', [id]);
  if (used.n) throw new ApiError(`该供应商已关联 ${used.n} 个器件，无法删除`);
  await pool.query('DELETE FROM supplier WHERE id=?', [id]);
  await writeLog(req, 'system', '删除供应商', `删除供应商 ID ${id}`);
  ok(res, null, '已删除');
}));

// ==================== 分类 ====================
router.get('/categories', requirePerm('comp:view'), wrap(async (req, res) => {
  const [list] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM component x WHERE x.category_id=c.id AND x.status=1) AS component_count
     FROM category c ORDER BY c.sort, c.id`);
  ok(res, { list });
}));

router.post('/categories', requirePerm('sys:master'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) throw new ApiError('分类名称必填');
  const [[dup]] = await pool.query('SELECT id FROM category WHERE name=?', [b.name]);
  if (dup) throw new ApiError('分类名称已存在');
  const [r] = await pool.query('INSERT INTO category (name,code,sort) VALUES (?,?,?)',
    [b.name, b.code || '', num(b.sort, 99)]);
  await writeLog(req, 'system', '新增分类', `新增分类 ${b.name}`);
  ok(res, { id: r.insertId }, '分类已创建');
}));

router.put('/categories/:id', requirePerm('sys:master'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const b = req.body || {};
  await pool.query('UPDATE category SET name=COALESCE(?,name), code=COALESCE(?,code), sort=COALESCE(?,sort) WHERE id=?',
    [b.name || null, b.code || null, b.sort ?? null, id]);
  ok(res, null, '保存成功');
}));

router.delete('/categories/:id', requirePerm('sys:master'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[used]] = await pool.query('SELECT COUNT(*) AS n FROM component WHERE category_id=?', [id]);
  if (used.n) throw new ApiError(`该分类下还有 ${used.n} 个器件，无法删除`);
  await pool.query('DELETE FROM category WHERE id=?', [id]);
  await writeLog(req, 'system', '删除分类', `删除分类 ID ${id}`);
  ok(res, null, '已删除');
}));

module.exports = router;
