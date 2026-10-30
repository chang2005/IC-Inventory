const express = require('express');
const pool = require('../db');
const { wrap, ok, ApiError, num, like, genOrderNo, writeLog } = require('../utils/helpers');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();
const analysisRouter = express.Router();

// ---------- BOM 列表 ----------
router.get('/', requirePerm('bom:view'), wrap(async (req, res) => {
  const { keyword } = req.query;
  const where = ['1=1'];
  const args = [];
  if (keyword) {
    where.push('(b.bom_no LIKE ? OR b.name LIKE ? OR b.product_name LIKE ?)');
    const k = like(keyword); args.push(k, k, k);
  }
  const [list] = await pool.query(
    `SELECT b.*, u.real_name AS creator_name,
            (SELECT COUNT(*) FROM bom_item bi WHERE bi.bom_id=b.id) AS item_count,
            (SELECT COUNT(*) FROM bom_item bi WHERE bi.bom_id=b.id AND bi.component_id IS NULL) AS unmatched_count,
            (SELECT MAX(created_at) FROM bom_analysis ba WHERE ba.bom_id=b.id) AS last_analyzed_at
     FROM bom b LEFT JOIN sys_user u ON u.id=b.created_by
     WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC`, args);
  ok(res, { list, total: list.length });
}));

// ---------- 导入 BOM（自动匹配） ----------
router.post('/import', requirePerm('bom:write'), wrap(async (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!b.name) throw new ApiError('请填写 BOM 名称');
  if (!items.length) throw new ApiError('BOM 明细为空，请检查 Excel 内容');
  if (items.length > 2000) throw new ApiError('单个 BOM 最多 2000 行');

  const [all] = await pool.query(
    'SELECT id,part_number,brand,model,name,package FROM component WHERE status=1');
  const byPart = new Map(all.map(c => [(c.part_number || '').toLowerCase(), c]));
  const byBrandModel = new Map(all.map(c => [`${(c.brand || '').toLowerCase()}|${(c.model || '').toLowerCase()}`, c]));
  const byModel = new Map(all.filter(c => c.model).map(c => [(c.model || '').toLowerCase(), c]));
  const byNamePkg = new Map();
  all.forEach(c => {
    const k = `${(c.name || '').toLowerCase()}|${(c.package || '').toLowerCase()}`;
    if (!byNamePkg.has(k)) byNamePkg.set(k, c);
  });

  const stats = { exact: 0, model_only: 0, fuzzy: 0, unmatched: 0 };
  const rows = items.map((it, i) => {
    const model = String(it.model || '').trim();
    const partNumber = String(it.part_number || '').trim();
    const brand = String(it.brand || '').trim();
    const name = String(it.name || '').trim();
    const pkg = String(it.package || '').trim();
    let matched = null, matchType = 'unmatched';
    if (partNumber && byPart.has(partNumber.toLowerCase())) {
      matched = byPart.get(partNumber.toLowerCase()); matchType = 'exact';
    }
    if (!matched && model) {
      const key1 = `${brand.toLowerCase()}|${model.toLowerCase()}`;
      if (byBrandModel.has(key1)) { matched = byBrandModel.get(key1); matchType = 'exact'; }
      else if (byModel.has(model.toLowerCase())) { matched = byModel.get(model.toLowerCase()); matchType = 'model_only'; }
    }
    if (!matched && name && pkg) {
      const key2 = `${name.toLowerCase()}|${pkg.toLowerCase()}`;
      if (byNamePkg.has(key2)) { matched = byNamePkg.get(key2); matchType = 'fuzzy'; }
    }
    if (!matched && name) {
      const cand = all.find(c => (c.name || '').toLowerCase() === name.toLowerCase());
      if (cand) { matched = cand; matchType = 'fuzzy'; }
    }
    stats[matchType]++;
    return {
      line: i + 2,
      component_id: matched ? matched.id : null,
      ref_des: String(it.ref_des || '').trim(),
      part_number: partNumber || null,
      name, brand, model,
      spec: String(it.spec || '').trim(),
      package: pkg,
      qty_per_unit: num(it.qty_per_unit) || 1,
      loss_rate: num(it.loss_rate),
      unit: it.unit || 'pcs',
      match_type: matchType,
      remark: it.remark || null
    };
  });

  const invalid = rows.filter(r => (!r.model && !r.part_number) || r.qty_per_unit <= 0);
  if (invalid.length) {
    throw new ApiError(`第 ${invalid.map(r => r.line).join('、')} 行数据不合法：型号或料号至少填一项、用量需大于 0`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const bomNo = b.bom_no || await genOrderNo(conn, 'bom', 'bom_no', 'BOM');
    const [r] = await conn.query(
      'INSERT INTO bom (bom_no,name,version,product_name,remark,created_by) VALUES (?,?,?,?,?,?)',
      [bomNo, b.name, b.version || 'V1.0', b.product_name || null, b.remark || null, req.user.id]);
    await conn.query(
      `INSERT INTO bom_item (bom_id,component_id,ref_des,part_number,name,brand,model,spec,package,qty_per_unit,loss_rate,unit,match_type,remark)
       VALUES ?`,
      [rows.map(x => [r.insertId, x.component_id, x.ref_des, x.part_number, x.name, x.brand, x.model, x.spec,
        x.package, x.qty_per_unit, x.loss_rate, x.unit, x.match_type, x.remark])]);
    await conn.commit();
    await writeLog(req, 'bom', '导入', `导入 ${bomNo} ${b.name}，共 ${rows.length} 行，未匹配 ${stats.unmatched} 行`);
    ok(res, { id: r.insertId, bom_no: bomNo, stats, total: rows.length }, 'BOM 导入成功');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// ---------- BOM 详情 ----------
router.get('/:id', requirePerm('bom:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[bom]] = await pool.query(
    `SELECT b.*, u.real_name AS creator_name FROM bom b LEFT JOIN sys_user u ON u.id=b.created_by WHERE b.id=?`, [id]);
  if (!bom) throw new ApiError('BOM 不存在', 404);
  const [items] = await pool.query(
    `SELECT bi.*, c.part_number AS c_part_number, c.brand AS c_brand, c.model AS c_model,
            c.name AS c_name, c.unit AS c_unit, c.min_stock,
            COALESCE(s.quantity,0) AS stock_qty, COALESCE(s.reserved,0) AS reserved_qty,
            COALESCE(s.in_transit,0) AS in_transit
     FROM bom_item bi
     LEFT JOIN component c ON c.id=bi.component_id
     LEFT JOIN stock s ON s.component_id=c.id
     WHERE bi.bom_id=? ORDER BY bi.id`, [id]);
  const [analyses] = await pool.query(
    `SELECT id,plan_qty,total_items,shortage_items,unmatched_items,ok_items,substitute_items,created_at
     FROM bom_analysis WHERE bom_id=? ORDER BY created_at DESC LIMIT 10`, [id]);
  const stats = {
    total: items.length,
    matched: items.filter(i => i.component_id).length,
    unmatched: items.filter(i => !i.component_id).length,
    fuzzy: items.filter(i => i.match_type === 'fuzzy').length
  };
  ok(res, { bom, items, analyses, stats });
}));

router.delete('/:id', requirePerm('bom:write'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[b]] = await pool.query('SELECT bom_no,name FROM bom WHERE id=?', [id]);
  if (!b) throw new ApiError('BOM 不存在', 404);
  await pool.query('DELETE FROM bom WHERE id=?', [id]);
  await writeLog(req, 'bom', '删除', `删除 ${b.bom_no} ${b.name}`);
  ok(res, null, 'BOM 已删除');
}));

// ---------- 人工确认匹配 ----------
router.post('/:id/items/:itemId/match', requirePerm('bom:write'), wrap(async (req, res) => {
  const { id, itemId } = req.params;
  const { component_id } = req.body || {};
  if (!component_id) throw new ApiError('请选择要匹配的器件');
  const [[c]] = await pool.query('SELECT id FROM component WHERE id=? AND status=1', [component_id]);
  if (!c) throw new ApiError('器件不存在', 404);
  const [r] = await pool.query(
    `UPDATE bom_item SET component_id=?, match_type='manual' WHERE id=? AND bom_id=?`,
    [component_id, num(itemId), num(id)]);
  if (!r.affectedRows) throw new ApiError('BOM 明细不存在', 404);
  await writeLog(req, 'bom', '人工匹配', `BOM ${id} 明细 ${itemId} 匹配到器件 ${component_id}`);
  ok(res, null, '匹配已更新');
}));

/** 未匹配行一键建档并回填匹配 */
router.post('/:id/items/:itemId/create', requirePerm('bom:write'), wrap(async (req, res) => {
  const { id, itemId } = req.params;
  const [[item]] = await pool.query('SELECT * FROM bom_item WHERE id=? AND bom_id=?', [num(itemId), num(id)]);
  if (!item) throw new ApiError('BOM 明细不存在', 404);
  if (item.component_id) throw new ApiError('该行已匹配，无需建档');
  const b = req.body || {};
  const partNumber = String(b.part_number || '').trim();
  if (!partNumber) throw new ApiError('请填写新料号');
  const [[dup]] = await pool.query('SELECT id FROM component WHERE part_number=?', [partNumber]);
  if (dup) throw new ApiError('料号已存在，请直接选择匹配');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO component (part_number,name,brand,model,spec,package,unit,category_id,lifecycle,min_stock,moq,lead_time_days,remark,status)
       VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?,1)`,
      [partNumber, item.name || b.name || '未命名器件', item.brand || b.brand || null,
        item.model || b.model || null, item.spec || b.spec || null, item.package || b.package || null,
        item.unit || 'pcs', b.category_id || null, num(b.min_stock), num(b.moq, 1), num(b.lead_time_days, 7), 'BOM 未匹配行建档']);
    await conn.query('INSERT INTO stock (component_id,quantity,reserved,in_transit,avg_price) VALUES (?,0,0,0,0)', [r.insertId]);
    await conn.query(`UPDATE bom_item SET component_id=?, match_type='manual' WHERE id=?`, [r.insertId, item.id]);
    await conn.commit();
    await writeLog(req, 'bom', '一键建档', `${partNumber} 由 BOM 未匹配行创建`);
    ok(res, { component_id: r.insertId, part_number: partNumber }, '建档并匹配成功');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// ---------- 缺料分析 ----------
router.post('/:id/analyze', requirePerm('bom:analyze'), wrap(async (req, res) => {
  const bomId = num(req.params.id);
  const planQty = Math.max(1, num(req.body?.plan_qty, 1));
  const [[bom]] = await pool.query('SELECT * FROM bom WHERE id=?', [bomId]);
  if (!bom) throw new ApiError('BOM 不存在', 404);

  const [items] = await pool.query(
    `SELECT bi.*, c.part_number, c.brand AS c_brand, c.model AS c_model, c.unit AS c_unit,
            c.min_stock,
            COALESCE(s.quantity,0) AS stock_qty, COALESCE(s.reserved,0) AS reserved,
            COALESCE(s.in_transit,0) AS in_transit
     FROM bom_item bi
     LEFT JOIN component c ON c.id=bi.component_id
     LEFT JOIN stock s ON s.component_id=c.id
     WHERE bi.bom_id=?`, [bomId]);
  if (!items.length) throw new ApiError('BOM 没有明细，无法分析');

  const result = [];
  for (const it of items) {
    const required = Math.ceil(num(it.qty_per_unit) * planQty * (1 + num(it.loss_rate) / 100));
    const available = num(it.stock_qty) - num(it.reserved) + num(it.in_transit);
    let shortage = Math.max(0, required - available);
    let status = !it.component_id ? 'unmatched' : shortage > 0 ? 'shortage' : 'ok';
    let substitute = null;
    if (shortage > 0 && it.component_id) {
      const [subs] = await pool.query(
        `SELECT c2.id, c2.part_number, c2.model, c2.name,
                COALESCE(s2.quantity,0)-COALESCE(s2.reserved,0)+COALESCE(s2.in_transit,0) AS avail
         FROM component_substitute cs
         JOIN component c2 ON c2.id=cs.substitute_id
         LEFT JOIN stock s2 ON s2.component_id=c2.id
         WHERE cs.component_id=?`, [it.component_id]);
      const subAvail = subs.reduce((a, s) => a + Math.max(0, num(s.avail)), 0);
      if (subAvail > 0) {
        const finalShortage = Math.max(0, shortage - subAvail);
        substitute = { subs, coverQty: Math.min(shortage, subAvail) };
        status = finalShortage === 0 ? 'substitute' : 'shortage';
        shortage = finalShortage;
      }
    }
    result.push({
      component_id: it.component_id, ref_des: it.ref_des, name: it.name, brand: it.brand,
      model: it.model, part_number: it.part_number, package: it.package, unit: it.c_unit || it.unit,
      qty_per_unit: num(it.qty_per_unit), loss_rate: num(it.loss_rate),
      required, stock_qty: num(it.stock_qty), reserved: num(it.reserved),
      in_transit: num(it.in_transit), available, shortage, status, substitute,
      min_stock: num(it.min_stock)
    });
  }
  const summary = {
    total: result.length,
    ok: result.filter(r => r.status === 'ok').length,
    shortage: result.filter(r => r.status === 'shortage').length,
    substitute: result.filter(r => r.status === 'substitute').length,
    unmatched: result.filter(r => r.status === 'unmatched').length
  };
  const [ins] = await pool.query(
    `INSERT INTO bom_analysis (bom_id,plan_qty,file_name,total_items,matched_items,shortage_items,ok_items,substitute_items,unmatched_items,result,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [bomId, planQty, `${bom.bom_no}_${bom.version}.xlsx`, summary.total, summary.total - summary.unmatched,
      summary.shortage + summary.substitute, summary.ok, summary.substitute, summary.unmatched,
      JSON.stringify(result), req.user.id]);

  await writeLog(req, 'bom', '缺料分析',
    `${bom.bom_no} 按 ${planQty} 台分析：充足 ${summary.ok}，缺料 ${summary.shortage}，替代可补 ${summary.substitute}，未匹配 ${summary.unmatched}`);

  ok(res, { analysisId: ins.insertId, plan_qty: planQty, bom, summary, result }, '分析完成');
}));

// ==================== 分析结果 ====================
analysisRouter.get('/', requirePerm('bom:view'), wrap(async (req, res) => {
  const { bom_id } = req.query;
  const where = bom_id ? 'WHERE ba.bom_id=?' : '';
  const args = bom_id ? [bom_id] : [];
  const [list] = await pool.query(
    `SELECT ba.id, ba.bom_id, ba.plan_qty, ba.total_items, ba.matched_items, ba.shortage_items,
            ba.ok_items, ba.substitute_items, ba.unmatched_items, ba.created_at,
            b.bom_no, b.name AS bom_name, b.version, u.real_name AS creator_name
     FROM bom_analysis ba JOIN bom b ON b.id=ba.bom_id
     LEFT JOIN sys_user u ON u.id=ba.created_by ${where}
     ORDER BY ba.created_at DESC LIMIT 50`, args);
  ok(res, { list });
}));

analysisRouter.get('/:id', requirePerm('bom:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[row]] = await pool.query(
    `SELECT ba.*, b.bom_no, b.name AS bom_name, b.version, b.product_name, u.real_name AS creator_name
     FROM bom_analysis ba JOIN bom b ON b.id=ba.bom_id
     LEFT JOIN sys_user u ON u.id=ba.created_by WHERE ba.id=?`, [id]);
  if (!row) throw new ApiError('分析记录不存在', 404);
  let result = row.result;
  if (typeof result === 'string') { try { result = JSON.parse(result); } catch { result = []; } }
  delete row.result;
  ok(res, { analysis: row, result: result || [] });
}));

/** 一键生成采购申请 */
analysisRouter.post('/:id/to-purchase-request', requirePerm('purchase:create'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[row]] = await pool.query(
    `SELECT ba.*, b.bom_no, b.name AS bom_name FROM bom_analysis ba JOIN bom b ON b.id=ba.bom_id WHERE ba.id=?`, [id]);
  if (!row) throw new ApiError('分析记录不存在', 404);
  let result = row.result;
  if (typeof result === 'string') { try { result = JSON.parse(result); } catch { result = []; } }
  const selected = Array.isArray(req.body?.component_ids) && req.body.component_ids.length
    ? new Set(req.body.component_ids.map(Number))
    : null;
  const need = (result || []).filter(r =>
    r.component_id && num(r.shortage) > 0 && (!selected || selected.has(Number(r.component_id))));
  if (!need.length) throw new ApiError('没有需要采购的缺料项');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const no = await genOrderNo(conn, 'purchase_request', 'request_no', 'PR');
    const [r] = await conn.query(
      `INSERT INTO purchase_request (request_no,source,bom_analysis_id,title,status,applicant_id,remark)
       VALUES (?,'bom_analysis',?,?,'pending',?,?)`,
      [no, id, `${row.bom_name} 缺料采购（${row.plan_qty} 台）`, req.user.id,
        `由 BOM 分析 ${row.bom_no} 自动生成，共 ${need.length} 项`]);
    await conn.query(
      'INSERT INTO purchase_request_item (request_id,component_id,quantity,remark) VALUES ?',
      [need.map(x => [r.insertId, x.component_id, Math.ceil(num(x.shortage)), `缺口 ${Math.ceil(num(x.shortage))}`])]);
    await conn.commit();
    await writeLog(req, 'purchase', '创建申请', `由分析 ${id} 生成 ${no}，${need.length} 项`);
    ok(res, { id: r.insertId, request_no: no, items: need.length }, `采购申请 ${no} 已生成`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = { router, analysisRouter };
