const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { wrap, ok, ApiError, writeLog } = require('../utils/helpers');
const { authenticate, sign, permsOf, ROLE_LABEL } = require('../middleware/auth');

const router = express.Router();

const publicUser = u => ({
  id: u.id,
  username: u.username,
  real_name: u.real_name,
  role: u.role,
  role_label: ROLE_LABEL[u.role] || u.role,
  dept: u.dept,
  email: u.email,
  phone: u.phone,
  last_login_at: u.last_login_at
});

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new ApiError('请输入账号和密码');

  const [[user]] = await pool.query('SELECT * FROM sys_user WHERE username=?', [username.trim()]);
  if (!user) throw new ApiError('账号或密码不正确', 401, 'LOGIN_FAILED');
  if (user.status !== 1) throw new ApiError('账号已被停用，请联系管理员', 403, 'DISABLED');

  const matched = await bcrypt.compare(password, user.password_hash);
  if (!matched) throw new ApiError('账号或密码不正确', 401, 'LOGIN_FAILED');

  await pool.query('UPDATE sys_user SET last_login_at=NOW() WHERE id=?', [user.id]);
  const token = sign(user);
  req.user = user;
  await writeLog(req, 'auth', '登录', `${user.real_name || user.username} 登录系统`);

  ok(res, {
    token,
    user: publicUser(user),
    permissions: permsOf(user.role)
  }, '登录成功');
}));

router.get('/me', authenticate, wrap(async (req, res) => {
  const [[user]] = await pool.query('SELECT * FROM sys_user WHERE id=?', [req.user.id]);
  ok(res, { user: publicUser(user), permissions: permsOf(user.role) });
}));

router.post('/password', authenticate, wrap(async (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) throw new ApiError('请填写原密码与新密码');
  if (String(new_password).length < 6) throw new ApiError('新密码至少 6 位');
  const [[user]] = await pool.query('SELECT * FROM sys_user WHERE id=?', [req.user.id]);
  const matched = await bcrypt.compare(old_password, user.password_hash);
  if (!matched) throw new ApiError('原密码不正确');
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE sys_user SET password_hash=? WHERE id=?', [hash, req.user.id]);
  await writeLog(req, 'auth', '修改密码', '用户修改了登录密码');
  ok(res, null, '密码修改成功');
}));

module.exports = router;
