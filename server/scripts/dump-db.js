/**
 * 导出数据库为 SQL 文件（不依赖 mysqldump）
 * 用法：node server/scripts/dump-db.js [输出目录]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const OUT_DIR = process.argv[2] || path.join(__dirname, '../../backup');

function q(name) { return '`' + String(name).replace(/`/g, '``') + '`'; }

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return "X'" + v.toString('hex') + "'";
  if (typeof v === 'object') v = JSON.stringify(v);
  return "'" + String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u0000/g, '\\0') + "'";
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'qjcrk',
    dateStrings: true,
    decimalNumbers: true
  });

  const dbName = process.env.DB_NAME || 'qjcrk';
  const [tables] = await conn.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema=? AND table_type="BASE TABLE" ORDER BY table_name',
    [dbName]
  );

  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;

  let out = '';
  out += `-- ${dbName} database dump\n`;
  out += `-- Generated: ${now.toISOString()}\n`;
  out += `-- Tables: ${tables.length}\n\n`;
  out += `CREATE DATABASE IF NOT EXISTS ${q(dbName)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`;
  out += `USE ${q(dbName)};\n\n`;
  out += `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`;

  let totalRows = 0;
  for (const { t } of tables) {
    const [[create]] = await conn.query('SHOW CREATE TABLE ' + q(t));
    const ddl = create['Create Table'] || Object.values(create)[1];
    out += `-- ----------------------------\n-- Table: ${t}\n-- ----------------------------\n`;
    out += `DROP TABLE IF EXISTS ${q(t)};\n`;
    out += ddl + ';\n\n';

    const [rows] = await conn.query('SELECT * FROM ' + q(t));
    totalRows += rows.length;
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const colSql = cols.map(q).join(', ');
      const BATCH = 100;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = chunk.map(r => '(' + cols.map(c => sqlValue(r[c])).join(', ') + ')').join(',\n');
        out += `INSERT INTO ${q(t)} (${colSql}) VALUES\n${values};\n`;
      }
      out += '\n';
    }
  }

  out += `SET FOREIGN_KEY_CHECKS = 1;\n`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${dbName}_${stamp}.sql`);
  fs.writeFileSync(file, out, 'utf8');

  console.log(`导出完成：${file}`);
  console.log(`表 ${tables.length} 张，数据 ${totalRows} 行，文件 ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
  await conn.end();
})().catch(e => { console.error('导出失败：', e.message); process.exit(1); });
