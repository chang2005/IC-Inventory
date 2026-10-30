const pool = require('../db');

class ApiError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ok = (res, data = null, message = 'success') => res.json({ code: 0, message, data });

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const paging = q => {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize, 10) || 15));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

const like = v => `%${String(v || '').replace(/[%_]/g, m => '\\' + m)}%`;

const today = () => {
  const d = new Date();
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

/** 生成单号：前缀 + 日期 + 4位序号 */
async function genOrderNo(conn, table, column, prefix) {
  const db = conn || pool;
  const head = `${prefix}${today()}`;
  const [[row]] = await db.query(
    `SELECT ${column} AS no FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`,
    [`${head}%`]
  );
  let seq = 1;
  if (row && row.no) seq = parseInt(String(row.no).slice(head.length), 10) + 1 || 1;
  return head + String(seq).padStart(4, '0');
}

/** 写操作日志 */
async function writeLog(req, module, action, detail) {
  try {
    const u = req.user || {};
    let ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    if (ip === '::1') ip = '127.0.0.1';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    await pool.query(
      'INSERT INTO operation_log (user_id,username,module,action,detail,ip) VALUES (?,?,?,?,?,?)',
      [u.id || null, u.username || null, module, action, String(detail || '').slice(0, 1000), ip]
    );
  } catch (e) {
    console.warn('写日志失败：', e.message);
  }
}

module.exports = { ApiError, wrap, ok, num, paging, like, genOrderNo, writeLog, pool };
