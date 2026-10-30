require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const path = require('path');
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { ApiError, ok } = require('./utils/helpers');
const { authenticate } = require('./middleware/auth');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const WEB_DIR = path.join(__dirname, '../web');

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', async (req, res, next) => {
  try {
    const [[row]] = await pool.query('SELECT 1 AS ok');
    ok(res, { db: row.ok === 1, time: new Date().toISOString() });
  } catch (e) { next(e); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/components', authenticate, require('./routes/components'));
app.use('/api/stock', authenticate, require('./routes/stock'));
const { router: bomRouter, analysisRouter } = require('./routes/boms');
app.use('/api/boms', authenticate, bomRouter);
app.use('/api/bom-analyses', authenticate, analysisRouter);
app.use('/api/purchase', authenticate, require('./routes/purchases'));
const { inboundRouter, outboundRouter } = require('./routes/orders');
app.use('/api/inbound-orders', authenticate, inboundRouter);
app.use('/api/outbound-orders', authenticate, outboundRouter);
app.use('/api/reports', authenticate, require('./routes/reports'));
app.use('/api/system', authenticate, require('./routes/system'));

app.use(express.static(WEB_DIR, { extensions: ['html'] }));

app.use('/api', (req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在：' + req.method + ' ' + req.originalUrl });
});

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(WEB_DIR, 'index.html'));
  }
  next();
});

app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'ER_DUP_ENTRY' ? 400 : 500);
  if (status >= 500) console.error('[ERROR]', err);
  const message = err.code === 'ER_DUP_ENTRY' ? '数据重复，请检查唯一字段'
    : err instanceof ApiError ? err.message
      : (status >= 500 ? '服务器内部错误：' + err.message : err.message);
  res.status(status).json({ code: status, message, error: process.env.NODE_ENV === 'development' ? err.stack : undefined });
});

app.listen(PORT, () => {
  console.log(`\n  电子元器件采购出入库系统`);
  console.log(`  服务地址：http://localhost:${PORT}`);
  console.log(`  数据库：${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}\n`);
});
