window.Pages = window.Pages || {};

window.Pages['page-bom'] = {
  name: 'page-bom',
  props: ['params', 'route'],
  data() {
    return {
      loading: false,
      boms: [],
      importDlg: {
        visible: false, step: 1, fileName: '', matrix: [], headers: [], dataRows: [],
        headerRow: -1, mapping: {}, rows: [], errors: [],
        name: '', version: 'V1.0', product_name: '', remark: '',
        drag: false, submitting: false, result: null
      },
      detail: { loading: false, bom: null, items: [], analyses: [], stats: {} },
      planQty: 300,
      analyzing: false,
      analysis: null,
      selected: [],
      matchDlg: { visible: false, item: null, loading: false, options: [], component_id: null },
      createDlg: { visible: false, item: null, saving: false, form: {} }
    };
  },
  computed: {
    isDetail() { return !!this.params?.id; },
    errorLines() { return new Set(this.importDlg.errors.map(e => e.line)); },
    validCount() { return this.importDlg.rows.length - this.importDlg.errors.length; },
    shortageRows() {
      if (!this.analysis) return [];
      return this.analysis.result.filter(r => r.status === 'shortage' || r.status === 'substitute');
    },
    canPurchase() { return this.can('purchase:create'); }
  },
  methods: {
    fmtQty: Utils.fmtQty,
    fmtDateTime: Utils.fmtDateTime,
    pill: Utils.pill,
    nowStr() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
    },
    go(p) { location.hash = '#' + p; },
    async loadList() {
      this.loading = true;
      try {
        const d = await Api.get('/boms');
        this.boms = d.list;
      } finally { this.loading = false; }
    },
    async loadDetail(id, autoLoad = true) {
      this.detail.loading = true;
      try {
        const d = await Api.get('/boms/' + id);
        this.detail = { ...d, loading: false };
        if (autoLoad && !this.analysis && d.analyses && d.analyses.length) {
          this.viewAnalysis(d.analyses[0], false);
        }
      } catch (e) {
        this.detail.loading = false;
      }
    },
    // ---------- 导入（自动识别表头与列，无需固定模板） ----------
    openImport() {
      this.importDlg = {
        visible: true, step: 1, fileName: '', matrix: [], headers: [], dataRows: [],
        headerRow: -1, mapping: {}, rows: [], errors: [],
        name: '', version: 'V1.0', product_name: '', remark: '',
        drag: false, submitting: false, result: null
      };
    },
    bomSchema() {
      return [
        { key: 'ref_des', label: '位号', type: 'refdes', priority: 10, patterns: [/位号/i, /器件位号/i, /^ref/i, /designator/i] },
        { key: 'part_number', label: '料号', type: 'model', priority: 9, noGuess: true, patterns: [/料号/i, /物料(编码|号)/i, /内部(料号|编码)/i, /item\s*code/i] },
        { key: 'model', label: '型号', type: 'model', priority: 9, patterns: [/型号/i, /\bmpn\b/i, /part\s*(number|no)/i, /\bmodel\b/i, /\bpn\b/i] },
        { key: 'brand', label: '品牌', type: 'brand', priority: 8, patterns: [/品牌/i, /厂家/i, /制造商/i, /manufacturer/i, /\bmfr\b/i, /\bbrand\b/i] },
        { key: 'package', label: '封装', type: 'package', priority: 7, patterns: [/封装/i, /package/i, /footprint/i] },
        { key: 'qty', label: '单台用量', type: 'num', priority: 7, patterns: [/单台用量/i, /^用量/i, /数量/i, /\bqty\b/i, /quantity/i, /per\s*board/i] },
        { key: 'loss', label: '损耗率', type: 'num', priority: 6, noGuess: true, patterns: [/损耗/i, /\bloss\b/i, /\bscrap\b/i] },
        { key: 'unit', label: '单位', type: 'unit', priority: 5, noGuess: true, patterns: [/单位/i, /\bunit\b/i, /\buom\b/i] },
        { key: 'name', label: '名称', type: 'text', priority: 4, patterns: [/名称/i, /品名/i, /描述/i, /description/i, /^desc/i] }
      ];
    },
    mappingFields() {
      return this.bomSchema().map(f => ({ key: f.key, label: f.label, req: f.key === 'model' }));
    },
    triggerFile() { this.$refs.bomFile && this.$refs.bomFile.click(); },
    onFilePick(e) {
      const f = e.target.files && e.target.files[0];
      if (f) this.parseFile(f);
      e.target.value = '';
    },
    onDrop(e) {
      this.importDlg.drag = false;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) this.parseFile(f);
    },
    async parseFile(file) {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return Api.toast('请上传 .xlsx / .xls / .csv 文件', 'warning');
      let matrix;
      try { matrix = await Utils.readMatrix(file); }
      catch (e) { return Api.toast('文件解析失败，请检查文件格式'); }
      if (!matrix.length) return Api.toast('文件中没有数据', 'warning');
      const res = Utils.smartTable(matrix, this.bomSchema());
      if (!res.dataRows.length) return Api.toast('未识别到数据行，请检查文件内容', 'warning');
      this.importDlg = {
        ...this.importDlg, fileName: file.name, matrix,
        headers: res.headers, dataRows: res.dataRows,
        headerRow: res.headerRow, mapping: res.mapping, step: 2
      };
      this.importDlg.name = file.name.replace(/\.(xlsx|xls|csv)$/i, '');
      this.buildRows();
    },
    buildRows() {
      const d = this.importDlg;
      const get = (row, key) => {
        const idx = d.mapping[key];
        if (idx === undefined || idx === '') return '';
        return String(row[Number(idx)] == null ? '' : row[Number(idx)]).trim();
      };
      const baseLine = d.headerRow >= 0 ? d.headerRow + 2 : 1;
      const rows = [];
      d.dataRows.forEach((r, i) => {
        const model = get(r, 'model');
        const partNumber = get(r, 'part_number');
        if (!model && !partNumber) return;
        const qtyRaw = get(r, 'qty');
        const lossRaw = get(r, 'loss');
        const row = {
          _line: baseLine + i,
          ref_des: get(r, 'ref_des'),
          name: get(r, 'name'),
          brand: get(r, 'brand'),
          model, part_number: partNumber,
          package: get(r, 'package'),
          qty_per_unit: qtyRaw === '' ? 1 : Utils.toNum(qtyRaw),
          loss_rate: lossRaw === '' ? 0 : Utils.toNum(lossRaw),
          unit: get(r, 'unit') || 'pcs'
        };
        const errs = [];
        if (!row.model && !row.part_number) errs.push('型号 / 料号至少填一项');
        if (!(row.qty_per_unit > 0)) errs.push('用量需大于 0');
        if (row.loss_rate < 0 || row.loss_rate > 100) errs.push('损耗率需在 0-100');
        row._errors = errs;
        rows.push(row);
      });
      const errors = [];
      rows.forEach(r => r._errors.forEach(m => errors.push({ line: r._line, message: m })));
      d.rows = rows;
      d.errors = errors;
    },
    setMap(key, value) {
      this.importDlg.mapping[key] = value === undefined || value === null ? '' : value;
      this.buildRows();
    },
    rowClass({ row }) { return row._errors && row._errors.length ? 'row-warning' : ''; },
    async submitImport() {
      const d = this.importDlg;
      if (!d.name) return Api.toast('请填写 BOM 名称', 'warning');
      if (!d.rows.length) return Api.toast('没有可导入的数据行', 'warning');
      if (d.errors.length) return Api.toast('存在错误行，请先修正列映射或数据', 'warning');
      d.submitting = true;
      try {
        const payload = {
          name: d.name, version: d.version, product_name: d.product_name, remark: d.remark,
          items: d.rows.map(r => ({
            ref_des: r.ref_des, name: r.name, brand: r.brand, model: r.model,
            part_number: r.part_number, package: r.package,
            qty_per_unit: r.qty_per_unit, unit: r.unit, loss_rate: r.loss_rate
          }))
        };
        const res = await Api.post('/boms/import', payload);
        d.result = res;
        d.step = 3;
        this.loadList();
      } catch (e) { /* handled */ } finally { d.submitting = false; }
    },
    // ---------- 分析 ----------
    async analyze() {
      if (!(this.planQty > 0)) return Api.toast('请输入计划生产数量', 'warning');
      this.analyzing = true;
      try {
        const d = await Api.post(`/boms/${this.detail.bom.id}/analyze`, { plan_qty: this.planQty });
        this.analysis = { ...d, created_at: this.nowStr() };
        this.selected = [];
        Api.toast('缺料分析完成', 'success');
        this.loadDetail(this.detail.bom.id);
      } catch (e) { /* handled */ } finally { this.analyzing = false; }
    },
    onSelect(rows) { this.selected = rows; },
    exportShortage() {
      if (!this.analysis) return;
      const rows = this.analysis.result.filter(r => r.shortage > 0 || r.status === 'unmatched');
      const head = ['状态', '位号', '名称', '品牌', '型号', '封装', '单台用量', '损耗率%', '需求量', '现有库存', '预留', '在途', '可用量', '缺口', '替代料提示'];
      const aoa = rows.map(r => [
        Utils.pill(r.status).text, r.ref_des, r.name, r.brand, r.model, r.package,
        r.qty_per_unit, r.loss_rate, r.required, r.stock_qty, r.reserved, r.in_transit, r.available,
        r.shortage, r.substitute ? `替代料可补 ${r.substitute.coverQty}` : ''
      ]);
      Utils.exportSheet([
        ['BOM', this.analysis.bom.bom_no + ' ' + this.analysis.bom.name, '计划数量', this.planQty],
        [], head, ...aoa
      ], `缺料清单_${this.analysis.bom.bom_no}.xlsx`, '缺料清单');
    },
    async toPurchase() {
      if (!this.analysis) return;
      const ids = this.selected.length ? this.selected.map(r => r.component_id) : null;
      const count = this.selected.length || this.shortageRows.filter(r => r.shortage > 0).length;
      if (!count) return Api.toast('没有需要采购的缺料项', 'warning');
      try {
        await this.$confirm(`将按缺口数量生成采购申请，共 ${count} 项。生成后可在「采购申请」中提交审批。`, '生成采购申请', {
          type: 'info', confirmButtonText: '确认生成', cancelButtonText: '取消'
        });
      } catch (e) { return; }
      try {
        const d = await Api.post(`/bom-analyses/${this.analysis.analysisId}/to-purchase-request`, { component_ids: ids });
        Api.toast(`采购申请 ${d.request_no} 已生成`, 'success');
        this.go('/purchase/requests');
      } catch (e) { /* handled */ }
    },
    // ---------- 人工匹配 ----------
    openMatch(item) {
      this.matchDlg = { visible: true, item, loading: false, options: [], component_id: null };
      this.searchComponents(item.model || item.name || '');
    },
    async searchComponents(q) {
      this.matchDlg.loading = true;
      try {
        const d = await Api.get('/components', { keyword: q, page: 1, pageSize: 20 });
        this.matchDlg.options = d.list;
      } finally { this.matchDlg.loading = false; }
    },
    async confirmMatch() {
      if (!this.matchDlg.component_id) return Api.toast('请选择要匹配的器件', 'warning');
      try {
        await Api.post(`/boms/${this.detail.bom.id}/items/${this.matchDlg.item.id}/match`, { component_id: this.matchDlg.component_id });
        Api.toast('匹配已更新，请重新分析', 'success');
        this.matchDlg.visible = false;
        this.analysis = null;
        this.loadDetail(this.detail.bom.id, false);
      } catch (e) { /* handled */ }
    },
    openCreate(item) {
      this.createDlg = {
        visible: true, item, saving: false,
        form: {
          part_number: 'PN-' + (item.model || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 24),
          name: item.name || '', brand: item.brand || '', model: item.model || '',
          package: item.package || '', category_id: '', min_stock: 0, moq: 1, lead_time_days: 14
        }
      };
    },
    async createComponent() {
      const f = this.createDlg.form;
      if (!f.part_number) return Api.toast('请填写新料号', 'warning');
      this.createDlg.saving = true;
      try {
        await Api.post(`/boms/${this.detail.bom.id}/items/${this.createDlg.item.id}/create`, f);
        Api.toast('建档并匹配成功，请重新分析', 'success');
        this.createDlg.visible = false;
        this.analysis = null;
        this.loadDetail(this.detail.bom.id, false);
      } catch (e) { /* handled */ } finally { this.createDlg.saving = false; }
    },
    async removeBom(row) {
      try {
        await this.$confirm(`确认删除 BOM「${row.bom_no} ${row.name}」？明细将一并删除。`, '删除 BOM', {
          type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消'
        });
      } catch (e) { return; }
      try {
        await Api.del('/boms/' + row.id);
        Api.toast('BOM 已删除', 'success');
        this.loadList();
      } catch (e) { /* handled */ }
    },
    viewAnalysis(a, scroll = true) {
      Api.get('/bom-analyses/' + a.id).then(d => {
        this.analysis = {
          analysisId: d.analysis.id, plan_qty: d.analysis.plan_qty, created_at: d.analysis.created_at,
          summary: {
            total: d.analysis.total_items, ok: d.analysis.ok_items, shortage: d.analysis.shortage_items,
            substitute: d.analysis.substitute_items, unmatched: d.analysis.unmatched_items
          },
          result: d.result, bom: this.detail.bom
        };
        this.planQty = d.analysis.plan_qty;
        if (!scroll) return;
        this.$nextTick(() => {
          const el = this.$refs.resultAnchor;
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }
  },
  mounted() {
    if (this.params?.id) this.loadDetail(this.params.id);
    else this.loadList();
  },
  template: `
  <div>
    <!-- ================= 列表 ================= -->
    <template v-if="!isDetail">
      <div class="page-head">
        <div>
          <h1 class="page-title"><span class="rule"></span>BOM 与缺料分析</h1>
          <p class="page-sub">上传 BOM 自动匹配器件档案，按计划产量计算缺口与替代料</p>
        </div>
        <div class="page-actions">
          <el-button v-if="can('bom:write')" type="primary" @click="openImport"><el-icon><Upload /></el-icon>导入 BOM</el-button>
        </div>
      </div>

      <div class="table-card">
        <el-table :data="boms" v-loading="loading" style="width:100%">
          <el-table-column label="BOM 编号" width="168">
            <template #default="{ row }">
              <span class="mono hover-link" @click="go('/bom/' + row.id)">{{ row.bom_no }}</span>
            </template>
          </el-table-column>
          <el-table-column label="名称 / 版本" min-width="200">
            <template #default="{ row }">
              <div class="cell-main">{{ row.name }}</div>
              <div class="cell-sub">{{ row.version }} · {{ row.product_name || '未关联产品' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="明细项" width="90" align="right">
            <template #default="{ row }"><span class="num">{{ row.item_count }}</span></template>
          </el-table-column>
          <el-table-column label="未匹配" width="90" align="right">
            <template #default="{ row }">
              <span class="num" :class="{ danger: row.unmatched_count > 0 }">{{ row.unmatched_count }}</span>
            </template>
          </el-table-column>
          <el-table-column label="最近分析" width="150">
            <template #default="{ row }">
              <span class="muted num">{{ row.last_analyzed_at ? fmtDateTime(row.last_analyzed_at) : '尚未分析' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="creator_name" label="创建人" width="90" />
          <el-table-column label="创建时间" width="140">
            <template #default="{ row }"><span class="muted num">{{ fmtDateTime(row.created_at) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="172" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="go('/bom/' + row.id)">查看</el-button>
              <el-button link type="primary" @click="go('/bom/' + row.id)">分析</el-button>
              <el-button v-if="can('bom:write')" link type="danger" @click="removeBom(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!boms.length && !loading" class="empty-box">
          <div class="ic"><el-icon><Grid /></el-icon></div>
          <div class="t">还没有 BOM</div>
          <div class="s">点击右上角「导入 BOM」，上传 Excel 后自动匹配器件档案</div>
        </div>
      </div>
    </template>

    <!-- ================= 详情 ================= -->
    <template v-else>
      <div class="page-head">
        <div>
          <div class="muted-2" style="font-size:12px;margin-bottom:8px;cursor:pointer" @click="go('/bom')">
            <el-icon style="vertical-align:-2px"><ArrowLeft /></el-icon> 返回 BOM 列表
          </div>
          <h1 class="page-title"><span class="rule"></span>{{ detail.bom?.name || 'BOM 详情' }}</h1>
          <p class="page-sub">
            <span class="mono">{{ detail.bom?.bom_no }}</span> · {{ detail.bom?.version }} · {{ detail.bom?.product_name || '未关联产品' }}
          </p>
        </div>
        <div class="page-actions">
          <el-tag type="info" effect="plain">明细 {{ detail.stats.total || 0 }} 项</el-tag>
          <el-tag v-if="detail.stats.unmatched" type="danger" effect="plain">未匹配 {{ detail.stats.unmatched }}</el-tag>
          <el-tag v-if="detail.stats.fuzzy" type="warning" effect="plain">疑似 {{ detail.stats.fuzzy }}</el-tag>
        </div>
      </div>

      <div class="panel" style="margin-bottom:16px">
        <div class="panel-body" style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap">
          <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">
            <div>
              <div class="kpi-label" style="margin-bottom:6px">计划生产数量</div>
              <el-input-number v-model="planQty" :min="1" :step="50" size="large" style="width:180px" />
            </div>
            <el-button type="primary" size="large" :loading="analyzing" @click="analyze">
              <el-icon><DataAnalysis /></el-icon>开始缺料分析
            </el-button>
            <span class="muted-2" style="font-size:11.5px;padding-bottom:8px">
              需求量 = ceil(单台用量 × 计划数量 × (1 + 损耗率))
            </span>
          </div>
          <div v-if="detail.analyses.length" style="display:flex;gap:8px;align-items:center">
            <span class="muted-2" style="font-size:11.5px">历史分析</span>
            <el-button v-for="a in detail.analyses.slice(0,3)" :key="a.id" size="small" @click="viewAnalysis(a)">
              {{ a.plan_qty }}台 · {{ fmtDateTime(a.created_at).slice(5,16) }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="analysis" ref="resultAnchor" class="panel" style="margin-bottom:16px">
        <div class="panel-head">
          <div>
            <div class="panel-title"><span class="bar"></span>缺料分析结果</div>
            <div class="panel-sub">计划生产 {{ analysis.plan_qty }} 台 · 分析时间 {{ analysis.created_at ? fmtDateTime(analysis.created_at) : '' }}</div>
          </div>
          <div class="flex gap-8">
            <el-button @click="exportShortage"><el-icon><Download /></el-icon>导出缺料清单</el-button>
            <el-button v-if="canPurchase" type="primary" @click="toPurchase">
              <el-icon><DocumentAdd /></el-icon>
              生成采购申请<template v-if="selected.length">（{{ selected.length }}）</template>
            </el-button>
          </div>
        </div>
        <div class="panel-body">
          <div class="ana-stats">
            <div class="ana-stat"><div class="l">分析明细</div><div class="v">{{ analysis.summary.total }}</div></div>
            <div class="ana-stat ok"><div class="l">库存充足</div><div class="v">{{ analysis.summary.ok }}</div></div>
            <div class="ana-stat danger"><div class="l">缺料</div><div class="v">{{ analysis.summary.shortage }}</div></div>
            <div class="ana-stat warn"><div class="l">替代可补</div><div class="v">{{ analysis.summary.substitute }}</div></div>
            <div class="ana-stat gray"><div class="l">未匹配</div><div class="v">{{ analysis.summary.unmatched }}</div></div>
          </div>
        </div>
        <el-table :data="analysis.result" size="default" style="width:100%" max-height="520"
                  @selection-change="onSelect" row-key="ref_des">
          <el-table-column type="selection" width="42" :selectable="r => r.shortage > 0" />
          <el-table-column label="状态" width="118">
            <template #default="{ row }">
              <span class="pill" :class="pill(row.status).color">{{ pill(row.status).text }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="ref_des" label="位号" min-width="110" show-overflow-tooltip />
          <el-table-column label="器件 / 型号" min-width="190">
            <template #default="{ row }">
              <div class="cell-main">{{ row.name || '—' }}</div>
              <div class="cell-sub">{{ row.brand }} · {{ row.model }}</div>
            </template>
          </el-table-column>
          <el-table-column label="需求量" width="88" align="right">
            <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtQty(row.required) }}</span></template>
          </el-table-column>
          <el-table-column label="现有" width="78" align="right">
            <template #default="{ row }"><span class="num muted">{{ fmtQty(row.stock_qty) }}</span></template>
          </el-table-column>
          <el-table-column label="在途" width="78" align="right">
            <template #default="{ row }"><span class="num muted">{{ fmtQty(row.in_transit) }}</span></template>
          </el-table-column>
          <el-table-column label="可用" width="78" align="right">
            <template #default="{ row }"><span class="num">{{ fmtQty(row.available) }}</span></template>
          </el-table-column>
          <el-table-column label="缺口" width="84" align="right">
            <template #default="{ row }">
              <span class="num" :class="{ danger: row.shortage > 0 }" style="font-weight:600">{{ row.shortage > 0 ? fmtQty(row.shortage) : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="替代料" min-width="130">
            <template #default="{ row }">
              <span v-if="row.substitute" class="muted" style="font-size:11.5px">
                可补 {{ fmtQty(row.substitute.coverQty) }}
                <el-tooltip :content="row.substitute.subs.map(s => s.part_number + '（可用 ' + fmtQty(s.avail) + '）').join('、')">
                  <el-icon style="vertical-align:-2px;color:#94a3b8"><InfoFilled /></el-icon>
                </el-tooltip>
              </span>
              <span v-else class="muted-2">—</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="center" fixed="right">
            <template #default="{ row }">
              <template v-if="row.status === 'unmatched'">
                <el-button link type="primary" @click="openMatch(row)">匹配</el-button>
                <el-button link type="primary" @click="openCreate(row)">建档</el-button>
              </template>
              <span v-else class="muted-2" style="font-size:11.5px">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><span class="bar"></span>BOM 明细</div>
          <span class="muted-2" style="font-size:11.5px">共 {{ detail.items.length }} 项</span>
        </div>
        <el-table :data="detail.items" v-loading="detail.loading" style="width:100%" max-height="520">
          <el-table-column prop="ref_des" label="位号" min-width="110" show-overflow-tooltip />
          <el-table-column label="名称 / 型号" min-width="200">
            <template #default="{ row }">
              <div class="cell-main">{{ row.name || '—' }}</div>
              <div class="cell-sub">
                {{ row.brand }} · {{ row.model }}<template v-if="row.part_number"> · 原厂料号 {{ row.part_number }}</template>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="package" label="封装" width="92" />
          <el-table-column label="单台用量" width="94" align="right">
            <template #default="{ row }"><span class="num">{{ fmtQty(row.qty_per_unit) }}</span></template>
          </el-table-column>
          <el-table-column label="损耗率" width="80" align="right">
            <template #default="{ row }"><span class="num muted">{{ row.loss_rate }}%</span></template>
          </el-table-column>
          <el-table-column label="匹配状态" width="124">
            <template #default="{ row }">
              <span class="pill" :class="pill(row.match_type).color">{{ pill(row.match_type).text }}</span>
            </template>
          </el-table-column>
          <el-table-column label="系统器件" min-width="150">
            <template #default="{ row }">
              <span v-if="row.component_id" class="mono">{{ row.c_part_number }}</span>
              <span v-else class="muted-2">未匹配</span>
            </template>
          </el-table-column>
          <el-table-column label="现有库存" width="100" align="right">
            <template #default="{ row }"><span class="num">{{ row.component_id ? fmtQty(row.stock_qty) : '—' }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center">
            <template #default="{ row }">
              <el-button v-if="!row.component_id && can('bom:write')" link type="primary" @click="openMatch(row)">匹配</el-button>
              <span v-else class="muted-2">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <!-- 导入 BOM -->
    <el-dialog v-model="importDlg.visible" title="导入 BOM" width="1000px" append-to-body :close-on-click-modal="false">
      <el-steps :active="importDlg.step - 1" align-center finish-status="success" style="margin-bottom:22px">
        <el-step title="上传文件" />
        <el-step title="预览校验" />
        <el-step title="自动匹配" />
      </el-steps>

      <div v-if="importDlg.step === 1">
        <div class="upload-zone" :class="{ dragover: importDlg.drag }"
             @click="triggerFile" @dragover.prevent="importDlg.drag = true"
             @dragleave.prevent="importDlg.drag = false" @drop.prevent="onDrop">
          <div class="ic"><el-icon><UploadFilled /></el-icon></div>
          <div class="t">拖拽 BOM 文件到此处，或点击选择</div>
          <div class="s">支持 .xlsx / .xls / .csv，单个 BOM 最多 2000 行</div>
          <div class="hint">不需要固定模板：自动定位表头行、识别列含义，也支持无表头文件</div>
        </div>
        <input ref="bomFile" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onFilePick" />
        <div class="flex-between" style="margin-top:16px">
          <span class="muted" style="font-size:12px">识别后可手动调整列映射；器件按 料号 → 品牌+型号 → 型号 → 名称+封装 自动匹配</span>
          <span class="pill blue no-dot">智能识别</span>
        </div>
      </div>

      <div v-else-if="importDlg.step === 2">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 14px;margin-bottom:12px">
          <el-form-item label="BOM 名称" required><el-input v-model="importDlg.name" placeholder="如 智能网关主板" /></el-form-item>
          <el-form-item label="版本"><el-input v-model="importDlg.version" placeholder="V1.0" /></el-form-item>
          <el-form-item label="对应产品"><el-input v-model="importDlg.product_name" placeholder="如 GW-300 智能网关" /></el-form-item>
        </div>
        <div class="flex-between" style="margin-bottom:8px">
          <div class="flex gap-12">
            <span class="file-chip" style="padding:6px 10px"><el-icon><Document /></el-icon>{{ importDlg.fileName }}</span>
            <span class="pill blue no-dot">{{ importDlg.headerRow >= 0 ? '表头：第 ' + (importDlg.headerRow + 1) + ' 行' : '无表头模式' }}</span>
            <span class="pill green no-dot">可导入 {{ validCount }} 行</span>
            <span v-if="importDlg.errors.length" class="pill red no-dot">错误 {{ importDlg.errors.length }} 处</span>
          </div>
          <el-button text @click="importDlg.step = 1; importDlg.rows = []; importDlg.errors = []">重新选择</el-button>
        </div>

        <div class="map-tip" style="margin-bottom:8px">
          <el-icon><MagicStick /></el-icon>
          已自动识别 {{ Object.keys(importDlg.mapping).length }} 个字段，如识别有误可在下方调整
        </div>
        <div class="map-bar" style="margin-bottom:12px">
          <div class="map-field" v-for="f in mappingFields()" :key="f.key">
            <span class="lb">{{ f.label }}<span v-if="f.req" class="req">*</span></span>
            <el-select :model-value="importDlg.mapping[f.key]" size="small" clearable placeholder="未映射"
                       @change="setMap(f.key, $event)">
              <el-option v-for="(h, i) in importDlg.headers" :key="i" :label="(h || ('列' + (i + 1)))" :value="String(i)" />
            </el-select>
          </div>
        </div>

        <el-alert v-if="importDlg.errors.length" type="error" :closable="false" style="margin-bottom:10px"
          :title="'存在 ' + importDlg.errors.length + ' 处问题：' + importDlg.errors.slice(0,4).map(e => '第' + e.line + '行 ' + e.message).join('；') + (importDlg.errors.length > 4 ? ' …' : '')" />
        <el-table :data="importDlg.rows" size="small" height="290" :row-class-name="rowClass" style="width:100%">
          <el-table-column label="行" width="46" align="center">
            <template #default="{ row }"><span class="muted-2">{{ row._line }}</span></template>
          </el-table-column>
          <el-table-column prop="ref_des" label="位号" width="104" show-overflow-tooltip />
          <el-table-column prop="name" label="名称" min-width="96" />
          <el-table-column prop="brand" label="品牌" width="86" />
          <el-table-column prop="model" label="型号" min-width="140" show-overflow-tooltip />
          <el-table-column prop="part_number" label="料号" min-width="110" show-overflow-tooltip />
          <el-table-column prop="package" label="封装" width="72" />
          <el-table-column label="用量" width="72" align="right">
            <template #default="{ row }"><span class="num">{{ row.qty_per_unit }}</span></template>
          </el-table-column>
          <el-table-column label="损耗" width="66" align="right">
            <template #default="{ row }"><span class="num">{{ row.loss_rate }}%</span></template>
          </el-table-column>
          <el-table-column label="校验" width="112">
            <template #default="{ row }">
              <span v-if="!row._errors.length" class="pill green">通过</span>
              <span v-else class="pill red">{{ row._errors[0] }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-else>
        <div class="empty-box" style="padding:20px">
          <div class="ic" style="color:#059669"><el-icon><CircleCheckFilled /></el-icon></div>
          <div class="t" style="font-size:15px">BOM 导入成功</div>
          <div class="s">{{ importDlg.result.bom_no }} · 共 {{ importDlg.result.total }} 行</div>
        </div>
        <div class="ana-stats" style="grid-template-columns:repeat(4,1fr)">
          <div class="ana-stat ok"><div class="l">精确匹配</div><div class="v">{{ importDlg.result.stats.exact }}</div></div>
          <div class="ana-stat"><div class="l">型号匹配</div><div class="v">{{ importDlg.result.stats.model_only }}</div></div>
          <div class="ana-stat warn"><div class="l">疑似匹配</div><div class="v">{{ importDlg.result.stats.fuzzy }}</div></div>
          <div class="ana-stat gray"><div class="l">未匹配</div><div class="v">{{ importDlg.result.stats.unmatched }}</div></div>
        </div>
        <el-alert type="info" :closable="false" style="margin-top:12px"
          title="未匹配行可在分析页「一键建档」或人工匹配；疑似匹配需人工确认，避免错料导致生产事故。" />
      </div>

      <template #footer>
        <el-button @click="importDlg.visible = false">{{ importDlg.step === 3 ? '完成' : '取消' }}</el-button>
        <el-button v-if="importDlg.step === 2" type="primary" :loading="importDlg.submitting"
                   :disabled="importDlg.errors.length > 0" @click="submitImport">
          导入并自动匹配
        </el-button>
        <el-button v-if="importDlg.step === 3" type="primary" @click="importDlg.visible = false; go('/bom/' + importDlg.result.id)">
          查看 BOM
        </el-button>
      </template>
    </el-dialog>

    <!-- 人工匹配 -->
    <el-dialog v-model="matchDlg.visible" title="匹配器件档案" width="520px" append-to-body>
      <template v-if="matchDlg.item">
        <el-alert type="info" :closable="false" style="margin-bottom:14px"
          :title="'BOM 行：' + (matchDlg.item.ref_des || '—') + ' · ' + (matchDlg.item.name || '') + ' / ' + (matchDlg.item.model || '')" />
        <el-form label-position="top">
          <el-form-item label="选择系统内器件" required>
            <el-select v-model="matchDlg.component_id" filterable remote :remote-method="searchComponents"
                       :loading="matchDlg.loading" placeholder="输入料号 / 型号搜索" style="width:100%">
              <el-option v-for="c in matchDlg.options" :key="c.id"
                         :label="c.part_number + ' · ' + c.name + ' / ' + (c.model || '')" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-form>
        <el-alert type="warning" :closable="false" title="请确认封装、参数与位号要求一致后再匹配，错配会导致缺料分析失真。" />
      </template>
      <template #footer>
        <el-button @click="matchDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmMatch">确认匹配</el-button>
      </template>
    </el-dialog>

    <!-- 未匹配一键建档 -->
    <el-dialog v-model="createDlg.visible" title="一键建档" width="560px" append-to-body>
      <template v-if="createDlg.item">
        <el-alert type="info" :closable="false" style="margin-bottom:14px"
          :title="'来源 BOM 行：' + (createDlg.item.ref_des || '') + ' · ' + (createDlg.item.name || '') + ' / ' + (createDlg.item.model || '')" />
        <el-form label-position="top">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
            <el-form-item label="新料号" required><el-input v-model="createDlg.form.part_number" /></el-form-item>
            <el-form-item label="分类">
              <el-select v-model="createDlg.form.category_id" clearable style="width:100%" placeholder="选择分类">
                <el-option v-for="c in Store.meta.categories" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="器件名称"><el-input v-model="createDlg.form.name" /></el-form-item>
            <el-form-item label="品牌"><el-input v-model="createDlg.form.brand" /></el-form-item>
            <el-form-item label="原厂型号"><el-input v-model="createDlg.form.model" /></el-form-item>
            <el-form-item label="封装"><el-input v-model="createDlg.form.package" /></el-form-item>
            <el-form-item label="安全库存"><el-input-number v-model="createDlg.form.min_stock" :min="0" style="width:100%" /></el-form-item>
            <el-form-item label="交期（天）"><el-input-number v-model="createDlg.form.lead_time_days" :min="1" style="width:100%" /></el-form-item>
          </div>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="createDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="createDlg.saving" @click="createComponent">建档并匹配</el-button>
      </template>
    </el-dialog>
  </div>
  `
};
