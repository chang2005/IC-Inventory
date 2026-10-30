const jwt = require('jsonwebtoken');
const pool = require('../db');
const { ApiError } = require('../utils/helpers');

const SECRET = process.env.JWT_SECRET || 'qjcrk_secret';
const EXPIRES = process.env.JWT_EXPIRES || '12h';

/** 权限矩阵：按角色划分 */
const PERMISSIONS = {
  super_admin: ['*'],
  admin: [
    'comp:view', 'comp:write', 'comp:import', 'comp:export',
    'stock:view', 'stock:confirm', 'stock:adjust', 'stock:check',
    'bom:view', 'bom:write', 'bom:analyze',
    'purchase:view', 'purchase:create', 'purchase:approve', 'purchase:order',
    'report:view', 'sys:master', 'sys:user:view', 'sys:log'
  ],
  employee: [
    'comp:view', 'comp:export',
    'stock:view',
    'bom:view', 'bom:write', 'bom:analyze',
    'purchase:view', 'purchase:create',
    'report:view'
  ]
};

const ROLE_LABEL = { super_admin: '超级管理员', admin: '管理员', employee: '员工' };

function permsOf(role) {
  if (role === 'super_admin') return ['*'];
  return PERMISSIONS[role] || [];
}

function can(user, perm) {
  if (!user) return false;
  const list = permsOf(user.role);
  return list.includes('*') || list.includes(perm);
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError('未登录或登录已过期', 401, 'UNAUTHORIZED');
    const payload = jwt.verify(token, SECRET);
    const [[user]] = await pool.query(
      'SELECT id,username,real_name,role,dept,email,phone,status,last_login_at FROM sys_user WHERE id=?',
      [payload.id]
    );
    if (!user) throw new ApiError('用户不存在', 401, 'UNAUTHORIZED');
    if (user.status !== 1) throw new ApiError('账号已被停用，请联系管理员', 403, 'DISABLED');
    req.user = user;
    req.perms = permsOf(user.role);
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') return next(new ApiError('登录已过期，请重新登录', 401, 'TOKEN_EXPIRED'));
    if (e.name === 'JsonWebTokenError') return next(new ApiError('登录凭证无效', 401, 'INVALID_TOKEN'));
    next(e);
  }
}

const requirePerm = (...perms) => (req, res, next) => {
  if (!req.user) return next(new ApiError('未登录', 401, 'UNAUTHORIZED'));
  if (perms.some(p => can(req.user, p))) return next();
  return next(new ApiError('当前角色无此操作权限', 403, 'FORBIDDEN'));
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new ApiError('未登录', 401, 'UNAUTHORIZED'));
  if (roles.includes(req.user.role)) return next();
  return next(new ApiError('当前角色无此操作权限', 403, 'FORBIDDEN'));
};

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: EXPIRES });
}

module.exports = { authenticate, requirePerm, requireRole, can, permsOf, sign, ROLE_LABEL, SECRET };
