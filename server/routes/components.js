const express = require('express');
const pool = require('../db');
const { wrap, ok, ApiError, paging, like, num, writeLog } = require('../utils/helpers');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();

const BASE_SELECT = `
  SELECT c.*, cat.name AS category_name,
         COALESCE(s.quantity,0)  AS quantity,
         COALESCE(s.reserved,0)  AS reserved,
         COALESCE(s.in_transit,0) AS in_transit,
         COALESCE(s.avg_price,0) AS avg_price,
         ROUND(COALESCE(s.quantity,0) * COALESCE(s.avg_price,0), 2) AS stock_value,
         ROUND(COALESCE(s.quantity,0) - COALESCE(s.reserved,0), 3) AS available,
         CASE WHEN COALESCE(s.quantity,0) < c.min_stock THEN 1 ELSE 0 END AS warning
  FROM component c
  LEFT JOIN stock s ON s.component_id = c.id
  LEFT JOIN category cat ON cat.id = c.category_id
`;

router.get('/', requirePerm('comp:view'), wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { keyword, category_id, brand, lifecycle, warning } = req.query;
  const where = ['c.status = 1'];
  const args = [];
  if (keyword) {
    where.push('(c.part_number LIKE ? OR c.name LIKE ? OR c.model LIKE ? OR c.brand LIKE ? OR c.spec LIKE ?)');
    const k = like(keyword);
    args.push(k, k, k, k, k);
  }
  if (category_id) { where.push('c.category_id = ?'); args.push(category_id); }
  if (brand) { where.push('c.brand = ?'); args.push(brand); }
  if (lifecycle) { where.push('c.lifecycle = ?'); args.push(lifecycle); }
  if (String(warning) === '1') where.push('COALESCE(s.quantity,0) < c.min_stock');
  const whereSql = 'WHERE ' + where.join(' AND ');

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM component c LEFT JOIN stock s ON s.component_id=c.id ${whereSql}`, args
  );
  const [list] = await pool.query(
    `${BASE_SELECT} ${whereSql} ORDER BY c.part_number ASC LIMIT ? OFFSET ?`,
    [...args, pageSize, offset]
  );

  const [[stats]] = await pool.query(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN COALESCE(s.quantity,0) < c.min_stock THEN 1 ELSE 0 END) AS warning,
           SUM(COALESCE(s.quantity,0)) AS total_qty,
           ROUND(SUM(COALESCE(s.quantity,0) * COALESCE(s.avg_price,0)),2) AS total_value
    FROM component c LEFT JOIN stock s ON s.component_id=c.id WHERE c.status=1`);

  ok(res, { list, total, page, pageSize, stats });
}));

router.get('/meta', requirePerm('comp:view'), wrap(async (req, res) => {
  const [categories] = await pool.query('SELECT id,name,code FROM category ORDER BY sort,id');
  const [brands] = await pool.query('SELECT DISTINCT brand FROM component WHERE status=1 AND brand IS NOT NULL ORDER BY brand');
  const [suppliers] = await pool.query('SELECT id,name,code FROM supplier WHERE status=1 ORDER BY id');
  ok(res, { categories, brands: brands.map(b => b.brand), suppliers });
}));

/** 批量匹配：按料号或型号自动匹配器件（用于 Excel 智能导入） */
router.post('/match', requirePerm('comp:view'), wrap(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return ok(res, { list: [] });
  if (items.length > 2000) throw new ApiError('单次最多匹配 2000 行');

  const parts = [...new Set(items.map(i => String(i.part_number || '').trim().toLowerCase()).filter(Boolean))];
  const models = [...new Set(items.map(i => String(i.model || '').trim().toLowerCase()).filter(Boolean))];
  let found = [];
  if (parts.length || models.length) {
    const conds = [];
    const args = [];
    if (parts.length) { conds.push(`LOWER(c.part_number) IN (${parts.map(() => '?').join(',')})`); args.push(...parts); }
    if (models.length) { conds.push(`LOWER(c.model) IN (${models.map(() => '?').join(',')})`); args.push(...models); }
    const [rows] = await pool.query(
      `SELECT c.id, c.part_number, c.name, c.brand, c.model, c.package, c.unit,
              COALESCE(s.quantity,0) AS quantity
       FROM component c LEFT JOIN stock s ON s.component_id=c.id
       WHERE c.status=1 AND (${conds.join(' OR ')})`, args);
    found = rows;
  }
  const byPart = new Map(found.map(c => [(c.part_number || '').toLowerCase(), c]));
  const byModel = new Map();
  found.forEach(c => {
    const k = (c.model || '').toLowerCase();
    if (k && !byModel.has(k)) byModel.set(k, c);
  });

  const list = items.map((it, index) => {
    const p = String(it.part_number || '').trim().toLowerCase();
    const m = String(it.model || '').trim().toLowerCase();
    let hit = (p && byPart.get(p)) || (m && byModel.get(m)) || null;
    return {
      index,
      component_id: hit ? hit.id : null,
      part_number: hit ? hit.part_number : null,
      name: hit ? hit.name : null,
      brand: hit ? hit.brand : null,
      model: hit ? hit.model : null,
      unit: hit ? hit.unit : null,
      stock_qty: hit ? Number(hit.quantity) : 0,
      matched_by: hit ? (p && byPart.get(p) ? 'part_number' : 'model') : null
    };
  });
  ok(res, { list });
}));

router.get('/:id', requirePerm('comp:view'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[component]] = await pool.query(`${BASE_SELECT} WHERE c.id = ?`, [id]);
  if (!component) throw new ApiError('器件不存在', 404);

  const [batches] = await pool.query(
    `SELECT b.*, sup.name AS supplier_name FROM stock_batch b
     LEFT JOIN supplier sup ON sup.id=b.supplier_id
     WHERE b.component_id=? AND b.quantity>0 ORDER BY b.created_at DESC`, [id]);
  const [suppliers] = await pool.query(
    `SELECT cs.*, sup.name AS supplier_name, sup.rating FROM component_supplier cs
     JOIN supplier sup ON sup.id=cs.supplier_id WHERE cs.component_id=? ORDER BY cs.is_primary DESC`, [id]);
  const [substitutes] = await pool.query(
    `SELECT cs.id, cs.type, cs.remark, c2.id AS component_id, c2.part_number, c2.name, c2.model,
            c2.brand, COALESCE(s2.quantity,0) AS quantity
     FROM component_substitute cs JOIN component c2 ON c2.id=cs.substitute_id
     LEFT JOIN stock s2 ON s2.component_id=c2.id
     WHERE cs.component_id=?`, [id]);
  const [transactions] = await pool.query(
    `SELECT t.*, u.real_name AS operator_name FROM stock_transaction t
     LEFT JOIN sys_user u ON u.id=t.operator_id
     WHERE t.component_id=? ORDER BY t.created_at DESC LIMIT 30`, [id]);

  ok(res, { component, batches, suppliers, substitutes, transactions });
}));

const UNIT_SET = ['pcs', '个', '只', '卷', '罐', '盘', '套', 'kg', 'm'];

router.post('/', requirePerm('comp:write'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.part_number || !String(b.part_number).trim()) throw new ApiError('料号不能为空');
  if (!b.name || !String(b.name).trim()) throw new ApiError('器件名称不能为空');
  if (b.unit && !UNIT_SET.includes(b.unit)) throw new ApiError('单位不合法');

  const [[exist]] = await pool.query('SELECT id FROM component WHERE part_number=?', [String(b.part_number).trim()]);
  if (exist) throw new ApiError('料号已存在：' + b.part_number);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO component (part_number,name,brand,model,spec,package,unit,category_id,lifecycle,min_stock,moq,lead_time_days,datasheet_url,remark,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [String(b.part_number).trim(), b.name, b.brand || null, b.model || null, b.spec || null,
        b.package || null, b.unit || 'pcs', b.category_id || null, b.lifecycle || 'active',
        num(b.min_stock), num(b.moq, 1), num(b.lead_time_days, 7), b.datasheet_url || null, b.remark || null]
    );
    await conn.query('INSERT INTO stock (component_id,quantity,reserved,in_transit,avg_price) VALUES (?,0,0,0,0)', [r.insertId]);
    await conn.commit();
    await writeLog(req, 'component', '新增', `新增器件 ${b.part_number} ${b.name}`);
    ok(res, { id: r.insertId }, '器件创建成功');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

router.put('/:id', requirePerm('comp:write'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const b = req.body || {};
  const [[exist]] = await pool.query('SELECT id FROM component WHERE id=?', [id]);
  if (!exist) throw new ApiError('器件不存在', 404);
  if (b.part_number) {
    const [[dup]] = await pool.query('SELECT id FROM component WHERE part_number=? AND id<>?', [b.part_number, id]);
    if (dup) throw new ApiError('料号已被其他器件占用');
  }
  await pool.query(
    `UPDATE component SET part_number=COALESCE(?,part_number), name=COALESCE(?,name), brand=?,
       model=?, spec=?, package=?, unit=COALESCE(?,unit), category_id=?, lifecycle=COALESCE(?,lifecycle),
       min_stock=COALESCE(?,min_stock), moq=COALESCE(?,moq), lead_time_days=COALESCE(?,lead_time_days),
       datasheet_url=?, remark=?
     WHERE id=?`,
    [b.part_number || null, b.name || null, b.brand ?? null, b.model ?? null, b.spec ?? null,
      b.package ?? null, b.unit || null, b.category_id || null, b.lifecycle || null,
      b.min_stock ?? null, b.moq ?? null, b.lead_time_days ?? null, b.datasheet_url ?? null,
      b.remark ?? null, id]
  );
  await writeLog(req, 'component', '编辑', `编辑器件 ${b.part_number || id}`);
  ok(res, null, '保存成功');
}));

router.delete('/:id', requirePerm('comp:delete'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const [[used]] = await pool.query('SELECT COUNT(*) AS n FROM bom_item WHERE component_id=?', [id]);
  await pool.query('UPDATE component SET status=0 WHERE id=?', [id]);
  await writeLog(req, 'component', '删除', `停用器件 ID ${id}${used.n ? `（被 ${used.n} 条 BOM 引用）` : ''}`);
  ok(res, null, '器件已停用');
}));

/** Excel 导入：料号存在则更新，不存在则新增 */
router.post('/import', requirePerm('comp:import'), wrap(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) throw new ApiError('没有可导入的数据');
  if (rows.length > 5000) throw new ApiError('单次最多导入 5000 条');

  const [cats] = await pool.query('SELECT id,name FROM category');
  const catMap = new Map(cats.map(c => [c.name, c.id]));

  const conn = await pool.getConnection();
  const failed = [];
  let created = 0, updated = 0;
  try {
    await conn.beginTransaction();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2;
      const pn = String(r.part_number || '').trim();
      const name = String(r.name || '').trim();
      if (!pn) { failed.push({ row: line, message: '料号不能为空' }); continue; }
      if (!name) { failed.push({ row: line, message: '名称不能为空' }); continue; }
      if (r.unit && !UNIT_SET.includes(String(r.unit).trim())) {
        failed.push({ row: line, message: `单位「${r.unit}」不合法` }); continue;
      }
      let catId = null;
      const catName = String(r.category || '').trim();
      if (catName) {
        if (!catMap.has(catName)) {
          const [cr] = await conn.query('INSERT INTO category (name,code,sort) VALUES (?,?,99)', [catName, '']);
          catMap.set(catName, cr.insertId);
        }
        catId = catMap.get(catName);
      }
      const [[exist]] = await conn.query('SELECT id FROM component WHERE part_number=?', [pn]);
      const vals = [name, r.brand || null, r.model || null, r.spec || null, r.package || null,
        r.unit || 'pcs', catId, r.lifecycle || 'active', num(r.min_stock),
        num(r.moq, 1), num(r.lead_time_days, 7), r.remark || null];
      if (exist) {
        await conn.query(
          `UPDATE component SET name=?,brand=?,model=?,spec=?,package=?,unit=?,category_id=?,lifecycle=?,min_stock=?,moq=?,lead_time_days=?,remark=? WHERE id=?`,
          [...vals, exist.id]
        );
        updated++;
      } else {
        const [cr] = await conn.query(
          `INSERT INTO component (name,brand,model,spec,package,unit,category_id,lifecycle,min_stock,moq,lead_time_days,remark,part_number,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`, [...vals, pn]
        );
        await conn.query('INSERT INTO stock (component_id,quantity,reserved,in_transit,avg_price) VALUES (?,0,0,0,0)', [cr.insertId]);
        created++;
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await writeLog(req, 'component', '导入', `Excel 导入 ${rows.length} 条：新增 ${created}，更新 ${updated}，失败 ${failed.length}`);
  ok(res, { created, updated, failed, total: rows.length },
    `导入完成：新增 ${created} 条，更新 ${updated} 条${failed.length ? `，失败 ${failed.length} 条` : ''}`);
}));

// ---------- 替代料 ----------
router.post('/:id/substitutes', requirePerm('comp:write'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const { substitute_id, type = 'full', remark } = req.body || {};
  if (!substitute_id) throw new ApiError('请选择替代料');
  if (num(substitute_id) === id) throw new ApiError('不能将自身设为替代料');
  const [[c]] = await pool.query('SELECT id FROM component WHERE id=?', [id]);
  const [[s]] = await pool.query('SELECT id FROM component WHERE id=?', [substitute_id]);
  if (!c || !s) throw new ApiError('器件不存在', 404);
  try {
    await pool.query('INSERT INTO component_substitute (component_id,substitute_id,type,remark) VALUES (?,?,?,?)',
      [id, substitute_id, type, remark || null]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ApiError('该替代关系已存在');
    throw e;
  }
  await writeLog(req, 'component', '新增替代料', `器件 ${id} 新增替代料 ${substitute_id}`);
  ok(res, null, '替代料已添加');
}));

router.delete('/:id/substitutes/:sid', requirePerm('comp:write'), wrap(async (req, res) => {
  await pool.query('DELETE FROM component_substitute WHERE id=? AND component_id=?',
    [num(req.params.sid), num(req.params.id)]);
  await writeLog(req, 'component', '删除替代料', `删除替代关系 ${req.params.sid}`);
  ok(res, null, '已删除');
}));

// ---------- 供应商关联 ----------
router.post('/:id/suppliers', requirePerm('comp:write'), wrap(async (req, res) => {
  const id = num(req.params.id);
  const { supplier_id, price = 0, moq = 1, lead_time_days = 7, supplier_part_no, is_primary = 0 } = req.body || {};
  if (!supplier_id) throw new ApiError('请选择供应商');
  try {
    await pool.query(
      `INSERT INTO component_supplier (component_id,supplier_id,supplier_part_no,price,moq,lead_time_days,is_primary)
       VALUES (?,?,?,?,?,?,?)`,
      [id, supplier_id, supplier_part_no || null, num(price), num(moq, 1), num(lead_time_days, 7), is_primary ? 1 : 0]
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ApiError('该供应商已关联');
    throw e;
  }
  ok(res, null, '供应商已关联');
}));

router.delete('/:id/suppliers/:sid', requirePerm('comp:write'), wrap(async (req, res) => {
  await pool.query('DELETE FROM component_supplier WHERE id=? AND component_id=?',
    [num(req.params.sid), num(req.params.id)]);
  ok(res, null, '已解除关联');
}));

module.exports = router;
