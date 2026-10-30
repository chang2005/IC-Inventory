const express = require('express');
const pool = require('../db');
const { wrap, ok, num } = require('../utils/helpers');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();

const dateKey = d => {
  const x = new Date(d);
  const p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

router.get('/dashboard', requirePerm('report:view'), wrap(async (req, res) => {
  const [[kpi]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM component WHERE status=1) AS components,
      (SELECT COALESCE(SUM(quantity),0) FROM stock) AS total_qty,
      (SELECT COALESCE(ROUND(SUM(quantity*avg_price),2),0) FROM stock) AS total_value,
      (SELECT COUNT(*) FROM component c JOIN stock s ON s.component_id=c.id
        WHERE c.status=1 AND s.quantity < c.min_stock) AS warning,
      (SELECT COUNT(*) FROM stock WHERE quantity<=0) AS zero_stock,
      (SELECT COALESCE(ROUND(SUM(in_transit*avg_price),2),0) FROM stock) AS transit_value,
      (SELECT COALESCE(SUM(in_transit),0) FROM stock) AS in_transit_qty,
      (SELECT COUNT(*) FROM inbound_order WHERE status='draft') AS pending_inbound,
      (SELECT COUNT(*) FROM outbound_order WHERE status='pending') AS pending_outbound,
      (SELECT COUNT(*) FROM purchase_request WHERE status='pending') AS pending_request,
      (SELECT COUNT(*) FROM purchase_order WHERE status IN ('draft','sent','partial')) AS open_orders,
      (SELECT COALESCE(SUM(-quantity),0) FROM stock_transaction
        WHERE type='out' AND created_at >= DATE_FORMAT(CURDATE(),'%Y-%m-01')) AS month_out
  `);

  const [trendRaw] = await pool.query(`
    SELECT DATE(created_at) AS d,
           SUM(CASE WHEN quantity>0 THEN quantity ELSE 0 END) AS in_qty,
           SUM(CASE WHEN quantity<0 THEN -quantity ELSE 0 END) AS out_qty
    FROM stock_transaction
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
    GROUP BY DATE(created_at) ORDER BY d`);
  const trendMap = new Map(trendRaw.map(r => [dateKey(r.d), r]));
  const trend = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const k = dateKey(d);
    const r = trendMap.get(k);
    trend.push({
      date: k,
      in_qty: r ? Math.round(num(r.in_qty)) : 0,
      out_qty: r ? Math.round(num(r.out_qty)) : 0
    });
  }

  const [category] = await pool.query(`
    SELECT COALESCE(cat.name,'未分类') AS name, COUNT(*) AS sku,
           ROUND(SUM(s.quantity*s.avg_price),2) AS value, SUM(s.quantity) AS qty
    FROM stock s JOIN component c ON c.id=s.component_id
    LEFT JOIN category cat ON cat.id=c.category_id
    WHERE c.status=1 GROUP BY cat.id, cat.name ORDER BY value DESC`);

  const [warnings] = await pool.query(`
    SELECT c.id AS component_id, c.part_number, c.name, c.model, c.brand, c.unit,
           s.quantity, c.min_stock, s.in_transit,
           ROUND(c.min_stock - s.quantity, 3) AS gap,
           ROUND((c.min_stock - s.quantity) / NULLIF(c.min_stock,0) * 100, 0) AS gap_pct
    FROM component c JOIN stock s ON s.component_id=c.id
    WHERE c.status=1 AND s.quantity < c.min_stock
    ORDER BY gap_pct DESC, gap DESC LIMIT 8`);

  const [shortageTop] = await pool.query(`
    SELECT c.part_number, c.name, c.model, c.unit, s.quantity, c.min_stock,
           ROUND(c.min_stock - s.quantity, 3) AS gap,
           ROUND((c.min_stock - s.quantity) * s.avg_price, 2) AS gap_value
    FROM component c JOIN stock s ON s.component_id=c.id
    WHERE c.status=1 AND s.quantity < c.min_stock
    ORDER BY gap_value DESC LIMIT 10`);

  const [recentTx] = await pool.query(`
    SELECT t.id, t.type, t.quantity, t.after_qty, t.created_at, t.ref_no,
           c.part_number, c.name, c.unit, u.real_name AS operator_name
    FROM stock_transaction t JOIN component c ON c.id=t.component_id
    LEFT JOIN sys_user u ON u.id=t.operator_id
    ORDER BY t.created_at DESC, t.id DESC LIMIT 8`);

  const [lifecycle] = await pool.query(`
    SELECT c.lifecycle, COUNT(*) AS n FROM component c WHERE c.status=1 GROUP BY c.lifecycle`);

  const [recentAnalyses] = await pool.query(`
    SELECT ba.id, ba.plan_qty, ba.total_items, ba.shortage_items, ba.unmatched_items, ba.created_at,
           b.bom_no, b.name AS bom_name
    FROM bom_analysis ba JOIN bom b ON b.id=ba.bom_id ORDER BY ba.created_at DESC LIMIT 5`);

  ok(res, {
    kpi, trend, category, warnings, shortageTop, recentTx, lifecycle, recentAnalyses,
    todo: {
      pending_inbound: kpi.pending_inbound,
      pending_outbound: kpi.pending_outbound,
      pending_request: kpi.pending_request,
      open_orders: kpi.open_orders
    }
  });
}));

router.get('/stock-summary', requirePerm('report:view'), wrap(async (req, res) => {
  const [byCategory] = await pool.query(`
    SELECT COALESCE(cat.name,'未分类') AS name, COUNT(*) AS sku,
           SUM(s.quantity) AS qty, ROUND(SUM(s.quantity*s.avg_price),2) AS value,
           SUM(CASE WHEN s.quantity < c.min_stock THEN 1 ELSE 0 END) AS warning
    FROM stock s JOIN component c ON c.id=s.component_id
    LEFT JOIN category cat ON cat.id=c.category_id
    WHERE c.status=1 GROUP BY cat.id, cat.name ORDER BY value DESC`);

  const [byBrand] = await pool.query(`
    SELECT COALESCE(c.brand,'未知品牌') AS name, COUNT(*) AS sku,
           ROUND(SUM(s.quantity*s.avg_price),2) AS value
    FROM stock s JOIN component c ON c.id=s.component_id
    WHERE c.status=1 GROUP BY c.brand ORDER BY value DESC LIMIT 10`);

  const [topValue] = await pool.query(`
    SELECT c.part_number, c.name, c.brand, c.model, c.unit, s.quantity, s.avg_price,
           ROUND(s.quantity*s.avg_price,2) AS value
    FROM stock s JOIN component c ON c.id=s.component_id
    WHERE c.status=1 ORDER BY value DESC LIMIT 10`);

  const [lifecycle] = await pool.query(`
    SELECT c.lifecycle, COUNT(*) AS sku, ROUND(SUM(s.quantity*s.avg_price),2) AS value
    FROM component c JOIN stock s ON s.component_id=c.id
    WHERE c.status=1 GROUP BY c.lifecycle`);

  const [[total]] = await pool.query(`
    SELECT COUNT(*) AS sku, COALESCE(SUM(s.quantity),0) AS qty,
           COALESCE(ROUND(SUM(s.quantity*s.avg_price),2),0) AS value,
           COALESCE(ROUND(SUM(s.in_transit*s.avg_price),2),0) AS transit_value
    FROM stock s JOIN component c ON c.id=s.component_id WHERE c.status=1`);

  ok(res, { byCategory, byBrand, topValue, lifecycle, total });
}));

router.get('/consumption', requirePerm('report:view'), wrap(async (req, res) => {
  const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 90));
  const [trendRaw] = await pool.query(
    `SELECT DATE(created_at) AS d, SUM(-quantity) AS qty
     FROM stock_transaction WHERE type='out' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at) ORDER BY d`, [days]);
  const trendMap = new Map(trendRaw.map(r => [dateKey(r.d), num(r.qty)]));
  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dateKey(new Date(Date.now() - i * 86400000));
    trend.push({ date: k, qty: trendMap.get(k) || 0 });
  }

  const [topConsumed] = await pool.query(
    `SELECT c.part_number, c.name, c.model, c.unit, SUM(-t.quantity) AS qty,
            COUNT(*) AS times, ROUND(SUM(-t.quantity*s.avg_price),2) AS amount
     FROM stock_transaction t JOIN component c ON c.id=t.component_id
     LEFT JOIN stock s ON s.component_id=c.id
     WHERE t.type='out' AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY t.component_id ORDER BY qty DESC LIMIT 12`, [days]);

  const [slowMoving] = await pool.query(
    `SELECT c.part_number, c.name, c.brand, c.model, c.unit, s.quantity,
            ROUND(s.quantity*s.avg_price,2) AS value,
            (SELECT MAX(t.created_at) FROM stock_transaction t
              WHERE t.component_id=c.id AND t.type='out') AS last_out_at
     FROM stock s JOIN component c ON c.id=s.component_id
     WHERE c.status=1 AND s.quantity > 0
       AND NOT EXISTS (SELECT 1 FROM stock_transaction t
                       WHERE t.component_id=c.id AND t.type='out'
                         AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY))
     ORDER BY value DESC LIMIT 20`, [days]);

  const [byType] = await pool.query(
    `SELECT o.type, COUNT(*) AS n, SUM(i.quantity) AS qty
     FROM outbound_order o JOIN outbound_order_item i ON i.order_id=o.id
     WHERE o.status='confirmed' AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY o.type`, [days]);

  ok(res, { days, trend, topConsumed, slowMoving, byType });
}));

router.get('/supplier-purchase', requirePerm('report:view'), wrap(async (req, res) => {
  const [bySupplier] = await pool.query(`
    SELECT s.id, s.name, s.rating, COUNT(o.id) AS order_count,
           COALESCE(SUM(o.total_amount),0) AS amount,
           MAX(o.created_at) AS last_order_at
    FROM supplier s LEFT JOIN purchase_order o ON o.supplier_id=s.id AND o.status<>'cancelled'
    GROUP BY s.id, s.name, s.rating ORDER BY amount DESC`);

  const [monthly] = await pool.query(`
    SELECT DATE_FORMAT(created_at,'%Y-%m') AS month, COUNT(*) AS orders,
           COALESCE(SUM(total_amount),0) AS amount
    FROM purchase_order WHERE status<>'cancelled'
    GROUP BY DATE_FORMAT(created_at,'%Y-%m') ORDER BY month DESC LIMIT 12`);

  const [topComponents] = await pool.query(`
    SELECT c.part_number, c.name, c.model, c.unit, SUM(i.quantity) AS qty,
           ROUND(SUM(i.quantity*i.unit_price),2) AS amount
    FROM purchase_order_item i JOIN component c ON c.id=i.component_id
    JOIN purchase_order o ON o.id=i.order_id AND o.status<>'cancelled'
    GROUP BY i.component_id ORDER BY amount DESC LIMIT 10`);

  ok(res, { bySupplier, monthly: monthly.reverse(), topComponents });
}));

module.exports = router;
