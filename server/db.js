const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'qjcrk',
  waitForConnections: true,
  connectionLimit: 12,
  queueLimit: 0,
  charset: 'utf8mb4',
  decimalNumbers: true,
  dateStrings: true
});

module.exports = pool;
