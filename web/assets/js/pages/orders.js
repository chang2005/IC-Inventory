window.Pages = window.Pages || {};

window.Pages['page-orders'] = {
  name: 'page-orders',
  props: ['params', 'route'],
  data() {
    return {
      type: 'inbound',
      loading: false,
      list: [],
      total: 0,
      page: 1,
      pageSize: 15,
      filters: { keyword: '', status: '' },
      detail: { visible: false, loading: false, data: null, confirming: false },
      create: {
        visible: false, saving: false,
        form: { type: 'purchase', supplier_id: '', project: '', remark: '' },
        items: []
      },
      impToken: 0,
      imp: {
        visible: false, step: 1, fileName: '', headers: [], dataRows: [], headerRow: -1,
        mapping: {}, rows: [], errors: [], drag: false, submitting: false, result: null,
        form: { type: 'purchase', supplier_id: '', remark: '', confirm: true }
      }
    };
  },
  computed: {
    isInbound() { return this.type === 'inbound'; },
    title() { return this.isInbound ? '入库管理' : '出库管理'; },
    sub() { return this.isInbound ? '采购到货、退料入库与批次登记' : '生产领料、借用与报废出库'; }
  },
  methods: {
    fmtQty: Utils.fmtQty,
    fmtMoney: Utils.fmtMoney,
    fmtDateTime: Utils.fmtDateTime,
    fmtDate: Utils.fmtDate,
    pill: Utils.pill,
    typeText(t) { return Utils.ORDER_TYPE[t] || t; },
    rowClass({ row }) { return row._errors && row._errors.length ? 'row-warning' : ''; },
    async load() {
      this.loading = true;
      try {
        const d = await Api.get(this.isInbound ? '/inbound-orders' : '/outbound-orders', {
          page: this.page, pageSize: this.pageSize,
          keyword: this.filters.keyword, status: this.filters.status
        });
        this.list = d.list;
        this.total = d.total;
      } finally { this.loading = false; }
    },
    async openDetail(row) {
      this.detail.visible = true;
      this.detail.loading = true;
      this.detail.data = null;
      try {
        this.detail.data = await Api.get(`${this.isInbound ? '/inbound-orders' : '/outbound-orders'}/${row.id}`);
      } finally { this.detail.loading = false; }
    },
    async confirmOrder() {
      const d = this.detail.data;
      if (!d) return;
      try {
        await this.$confirm(this.isInbound
          ? '确认入库？系统将增加库存、登记批次并更新移动加权均价，操作不可撤销。'
          : '确认出库？系统将扣减库存并写入流水，操作不可撤销。', this.isInbound ? '确认入库' : '确认出库', {
          type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消'
        });
      } catch (e) { return; }
      this.detail.confirming = true;
      try {
        await Api.post(`${this.isInbound ? '/inbound-orders' : '/outbound-orders'}/${d.order.id}/confirm`);
        Api.toast(this.isInbound ? '入库成功，库存已更新' : '出库成功，库存已扣减', 'success');
        this.detail.visible = false;
        this.load();
      } catch (e) { /* handled */ } finally { this.detail.confirming = false; }
    },
    async submitOrder() {
      const d = this.detail.data;
      try {
        await Api.post(`/outbound-orders/${d.order.id}/submit`);
        Api.toast('已提交，库存已预占', 'success');
        this.openDetail(d.order);
        this.load();
      } catch (e) { /* handled */ }
    },
    async cancelOrder() {
      const d = this.detail.data;
      try {
        await this.$confirm('确认作废该单据？' + (this.isInbound ? '' : '已预占的库存将释放。'), '作废单据', { type: 'warning' });
      } catch (e) { return; }
      try {
        await Api.post(`${this.isInbound ? '/inbound-orders' : '/outbound-orders'}/${d.order.id}/cancel`);
        Api.toast('单据已作废', 'success');
        this.detail.visible = false;
        this.load();
      } catch (e) { /* handled */ }
    },
    // ---------- Excel 智能导入入库 ----------
    openImport() {
      this.imp = {
        visible: true, step: 1, fileName: '', headers: [], dataRows: [], headerRow: -1,
        mapping: {}, rows: [], errors: [], drag: false, submitting: false, result: null,
        form: { type: 'purchase', supplier_id: '', remark: '', confirm: true }
      };
    },
    inboundSchema() {
      return [
        { key: 'part_number', label: '料号', type: 'model', priority: 10, patterns: [/料号/i, /物料(编码|号)/i, /内部(料号|编码)/i, /item\s*code/i, /\bpn\b/i] },
        { key: 'model', label: '型号', type: 'model', priority: 9, patterns: [/型号/i, /\bmpn\b/i, /part\s*(number|no)/i, /\bmodel\b/i] },
        { key: 'quantity', label: '数量', type: 'num', priority: 8, patterns: [/数量/i, /\bqty\b/i, /quantity/i, /到货/i, /入库数量/i] },
        { key: 'unit_price', label: '单价', type: 'num', priority: 7, noGuess: true, patterns: [/单价/i, /价格/i, /\bprice\b/i, /cost/i] },
        { key: 'batch_no', label: '批次', type: 'text', priority: 6, noGuess: true, patterns: [/批次/i, /批号/i, /\bbatch\b/i, /\blot\b/i] },
        { key: 'location', label: '库位', type: 'text', priority: 5, noGuess: true, patterns: [/库位/i, /货位/i, /储位/i, /location/i] },
        { key: 'expiry_date', label: '有效期', type: 'text', priority: 4, noGuess: true, patterns: [/有效期/i, /保质期/i, /expiry/i, /expire/i] },
        { key: 'name', label: '名称', type: 'text', priority: 3, noGuess: true, patterns: [/名称/i, /品名/i, /description/i] }
      ];
    },
    importFields() {
      return this.inboundSchema().map(f => ({ key: f.key, label: f.label, req: f.key === 'quantity' }));
    },
    triggerImport() { this.$refs.impFile && this.$refs.impFile.click(); },
    onImportFile(e) {
      const f = e.target.files && e.target.files[0];
      if (f) this.parseImport(f);
      e.target.value = '';
    },
    onImportDrop(e) {
      this.imp.drag = false;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) this.parseImport(f);
    },
    async parseImport(file) {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return Api.toast('请上传 .xlsx / .xls / .csv 文件', 'warning');
      let matrix;
      try { matrix = await Utils.readMatrix(file); }
      catch (e) { return Api.toast('文件解析失败，请检查文件格式'); }
      if (!matrix.length) return Api.toast('文件中没有数据', 'warning');
      const res = Utils.smartTable(matrix, this.inboundSchema());
      if (!res.dataRows.length) return Api.toast('未识别到数据行，请检查文件内容', 'warning');
      this.imp = {
        ...this.imp, fileName: file.name, headers: res.headers, dataRows: res.dataRows,
        headerRow: res.headerRow, mapping: res.mapping, step: 2
      };
      await this.buildImportRows();
    },
    setImportMap(key, value) {
      this.imp.mapping[key] = value === undefined || value === null ? '' : value;
      this.buildImportRows();
    },
    normDate(v) {
      if (!v) return null;
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      let m = s.match(/^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/);
      if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
      m = s.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
      if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      }
      return null;
    },
    async buildImportRows() {
      const d = this.imp;
      const get = key => {
        const idx = d.mapping[key];
        return (row) => (idx === undefined || idx === '' ? '' : String(row[Number(idx)] == null ? '' : row[Number(idx)]).trim());
      };
      const getters = {};
      ['part_number', 'model', 'quantity', 'unit_price', 'batch_no', 'location', 'expiry_date', 'name']
        .forEach(k => { getters[k] = get(k); });
      const baseLine = d.headerRow >= 0 ? d.headerRow + 2 : 1;
      const rows = [];
      d.dataRows.forEach((r, i) => {
        const pn = getters.part_number(r);
        const md = getters.model(r);
        if (!pn && !md) return;
        const qtyRaw = getters.quantity(r);
        const row = {
          _line: baseLine + i,
          part_number: pn || md,
          model: md || pn,
          name: getters.name(r),
          quantity: qtyRaw === '' ? 0 : Utils.toNum(qtyRaw),
          unit_price: Utils.toNum(getters.unit_price(r)),
          batch_no: getters.batch_no(r),
          location: getters.location(r),
          expiry_date: this.normDate(getters.expiry_date(r)),
          component_id: null, matched: null, _errors: []
        };
        if (!(row.quantity > 0)) row._errors.push('数量需大于 0');
        rows.push(row);
      });
      const token = ++this.impToken;
      d.rows = rows;
      if (rows.length) {
        try {
          const res = await Api.post('/components/match', {
            items: rows.map(r => ({ part_number: r.part_number, model: r.model }))
          }, { silent: true });
          if (token !== this.impToken) return;
          (res.list || []).forEach(m => {
            const row = d.rows[m.index];
            if (!row) return;
            row.component_id = m.component_id || null;
            row.matched = m.component_id ? m : null;
            if (!m.component_id) row._errors.push('未匹配到器件');
          });
        } catch (e) {
          if (token !== this.impToken) return;
          d.rows.forEach(r => r._errors.push('匹配服务异常'));
        }
      }
      const errors = [];
      d.rows.forEach(r => r._errors.forEach(msg => errors.push({ line: r._line, message: msg })));
      d.errors = errors;
    },
    async submitImport() {
      const d = this.imp;
      const valid = d.rows.filter(r => r.component_id && r.quantity > 0);
      if (!valid.length) return Api.toast('没有匹配成功的有效行', 'warning');
      const skipped = d.rows.length - valid.length;
      if (skipped > 0) {
        try {
          await this.$confirm(`${skipped} 行未匹配或数量无效，将被跳过，是否继续导入剩余 ${valid.length} 项？`, '部分数据将被跳过', {
            type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '返回检查'
          });
        } catch (e) { return; }
      }
      d.submitting = true;
      try {
        const res = await Api.post('/inbound-orders/import', {
          type: d.form.type,
          supplier_id: d.form.supplier_id || null,
          remark: d.form.remark || 'Excel 导入入库',
          confirm: d.form.confirm,
          items: valid.map(r => ({
            component_id: r.component_id, quantity: r.quantity, unit_price: r.unit_price,
            batch_no: r.batch_no || null, location: r.location || null, expiry_date: r.expiry_date || null
          }))
        });
        d.result = res;
        d.step = 3;
        this.load();
      } catch (e) { /* handled */ } finally { d.submitting = false; }
    },

    // ---------- 新建 ----------
    openCreate() {
      this.create = {
        visible: true, saving: false,
        form: {
          type: this.isInbound ? 'purchase' : 'production',
          supplier_id: '', project: '', remark: ''
        },
        items: [this.blankItem()]
      };
    },
    blankItem() {
      return {
        component_id: null, quantity: 1, unit_price: 0, batch_no: '', location: '',
        expiry_date: '', purpose: '', options: [], loading: false
      };
    },
    addItem() { this.create.items.push(this.blankItem()); },
    removeItem(i) { this.create.items.splice(i, 1); },
    async searchComp(item, q) {
      item.loading = true;
      try {
        const d = await Api.get('/components', { keyword: q, page: 1, pageSize: 20 });
        item.options = d.list;
      } finally { item.loading = false; }
    },
    async saveCreate() {
      const items = this.create.items.filter(i => i.component_id && i.quantity > 0);
      if (!items.length) return Api.toast('请至少添加一个有效明细', 'warning');
      this.create.saving = true;
      try {
        const payload = this.isInbound
          ? {
            type: this.create.form.type, supplier_id: this.create.form.supplier_id || null,
            remark: this.create.form.remark,
            items: items.map(i => ({
              component_id: i.component_id, quantity: i.quantity, unit_price: i.unit_price,
              batch_no: i.batch_no || null, location: i.location || null, expiry_date: i.expiry_date || null
            }))
          }
          : {
            type: this.create.form.type, project: this.create.form.project,
            remark: this.create.form.remark,
            items: items.map(i => ({ component_id: i.component_id, quantity: i.quantity, purpose: i.purpose || this.create.form.project }))
          };
        const d = await Api.post(this.isInbound ? '/inbound-orders' : '/outbound-orders', payload);
        Api.toast(`${d.order_no} 已创建${this.isInbound ? '，确认后增加库存' : '，提交后预占库存'}`, 'success');
        this.create.visible = false;
        this.load();
      } catch (e) { /* handled */ } finally { this.create.saving = false; }
    }
  },
  mounted() {
    this.type = this.route?.orderType || 'inbound';
    this.load();
  },
  template: `
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>{{ title }}</h1>
        <p class="page-sub">{{ sub }}</p>
      </div>
      <div class="page-actions">
        <el-button @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button v-if="isInbound && can('stock:confirm')" @click="openImport">
          <el-icon><Upload /></el-icon>导入入库
        </el-button>
        <el-button v-if="can('stock:view')" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>{{ isInbound ? '新建入库单' : '新建出库单' }}
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input v-model="filters.keyword" :placeholder="isInbound ? '搜索单号 / 供应商 / 备注' : '搜索单号 / 项目 / 备注'"
                clearable style="width:250px" @keyup.enter="load" @clear="load">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width:140px" @change="load">
        <el-option label="草稿" value="draft" />
        <el-option v-if="!isInbound" label="待出库" value="pending" />
        <el-option label="已确认" value="confirmed" />
        <el-option label="已作废" value="cancelled" />
      </el-select>
      <div class="spacer"></div>
      <el-button @click="filters = { keyword: '', status: '' }; load()">重置</el-button>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" style="width:100%">
        <el-table-column label="单号" width="172">
          <template #default="{ row }">
            <span class="mono hover-link" @click="openDetail(row)">{{ row.order_no }}</span>
            <div class="cell-sub">{{ row.item_count }} 项明细</div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="96">
          <template #default="{ row }"><span class="pill blue no-dot">{{ typeText(row.type) }}</span></template>
        </el-table-column>
        <el-table-column v-if="isInbound" prop="supplier_name" label="供应商" min-width="180" show-overflow-tooltip />
        <el-table-column v-else label="项目 / 关联 BOM" min-width="170">
          <template #default="{ row }">
            <div class="cell-main">{{ row.project || '—' }}</div>
            <div class="cell-sub">{{ row.bom_no ? row.bom_no + ' ' + (row.bom_name || '') : '未关联 BOM' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="96" align="right">
          <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtQty(row.total_qty) }}</span></template>
        </el-table-column>
        <el-table-column v-if="isInbound" label="金额" width="108" align="right">
          <template #default="{ row }"><span class="num">{{ fmtMoney(row.total_amount) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="106">
          <template #default="{ row }"><span class="pill" :class="pill(row.status).color">{{ pill(row.status).text }}</span></template>
        </el-table-column>
        <el-table-column prop="operator_name" label="制单人" width="84" />
        <el-table-column label="创建时间" width="136">
          <template #default="{ row }"><span class="muted num">{{ fmtDateTime(row.created_at) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="122" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status === 'draft' && can('stock:confirm')" link type="primary" @click="openDetail(row)">确认</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <span class="info">共 {{ total }} 条记录</span>
        <el-pagination background layout="prev, pager, next, sizes" :total="total"
          v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[15, 30, 50]"
          @current-change="load" @size-change="load" />
      </div>
    </div>

    <!-- 详情 -->
    <el-drawer v-model="detail.visible" size="760px" :title="isInbound ? '入库单详情' : '出库单详情'" destroy-on-close>
      <div v-loading="detail.loading">
        <template v-if="detail.data">
          <div class="detail-hero">
            <div class="pn">{{ detail.data.order.order_no }}</div>
            <h3>{{ typeText(detail.data.order.type) }}<template v-if="detail.data.order.supplier_name"> · {{ detail.data.order.supplier_name }}</template><template v-else-if="detail.data.order.project"> · {{ detail.data.order.project }}</template></h3>
            <div class="detail-tags">
              <span class="pill" :class="pill(detail.data.order.status).color">{{ pill(detail.data.order.status).text }}</span>
              <span class="pill gray no-dot">制单 {{ detail.data.order.operator_name }}</span>
              <span v-if="detail.data.order.confirmer_name" class="pill gray no-dot">确认 {{ detail.data.order.confirmer_name }}</span>
            </div>
            <div class="detail-kpis" style="grid-template-columns:repeat(3,1fr)">
              <div class="detail-kpi"><div class="l">明细项</div><div class="v">{{ detail.data.items.length }}</div></div>
              <div class="detail-kpi"><div class="l">总数量</div><div class="v">{{ fmtQty(detail.data.order.total_qty) }}</div></div>
              <div class="detail-kpi">
                <div class="l">{{ isInbound ? '总金额' : '创建时间' }}</div>
                <div class="v" style="font-size:15px">{{ isInbound ? fmtMoney(detail.data.order.total_amount) : fmtDateTime(detail.data.order.created_at) }}</div>
              </div>
            </div>
          </div>
          <div style="padding:18px 22px">
            <div class="section-title">单据明细</div>
            <el-table :data="detail.data.items" size="small" style="width:100%">
              <el-table-column label="料号" min-width="140">
                <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
              </el-table-column>
              <el-table-column prop="name" label="器件" min-width="110" />
              <el-table-column prop="package" label="封装" width="86" />
              <el-table-column label="数量" width="90" align="right">
                <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtQty(row.quantity) }}</span></template>
              </el-table-column>
              <template v-if="isInbound">
                <el-table-column label="单价" width="94" align="right">
                  <template #default="{ row }"><span class="num">{{ fmtMoney(row.unit_price, 4) }}</span></template>
                </el-table-column>
                <el-table-column label="批次号" min-width="120">
                  <template #default="{ row }"><span class="mono">{{ row.batch_no || '系统生成' }}</span></template>
                </el-table-column>
                <el-table-column prop="location" label="库位" width="92" />
              </template>
              <el-table-column v-else prop="purpose" label="用途" min-width="130" show-overflow-tooltip />
            </el-table>
            <div v-if="detail.data.order.remark" style="margin-top:14px">
              <div class="section-title">备注</div>
              <div class="muted" style="font-size:12.5px">{{ detail.data.order.remark }}</div>
            </div>
          </div>
        </template>
      </div>
      <template #footer>
        <div class="flex-between">
          <el-button v-if="detail.data && detail.data.order.status === 'draft' && can('stock:confirm')" type="danger" plain @click="cancelOrder">作废单据</el-button>
          <span v-else></span>
          <div>
            <el-button @click="detail.visible = false">关闭</el-button>
            <el-button v-if="detail.data && !isInbound && detail.data.order.status === 'draft'" type="primary" @click="submitOrder">提交并预占</el-button>
            <el-button v-if="detail.data && detail.data.order.status === 'draft' && can('stock:confirm')"
                       type="primary" :loading="detail.confirming" @click="confirmOrder">
              {{ isInbound ? '确认入库' : '确认出库' }}
            </el-button>
            <el-button v-if="detail.data && !isInbound && detail.data.order.status === 'pending' && can('stock:confirm')"
                       type="primary" :loading="detail.confirming" @click="confirmOrder">确认出库</el-button>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 导入入库 -->
    <el-dialog v-model="imp.visible" title="导入入库" width="1000px" append-to-body :close-on-click-modal="false">
      <el-steps :active="imp.step - 1" align-center finish-status="success" style="margin-bottom:20px">
        <el-step title="上传到货明细" />
        <el-step title="自动匹配" />
        <el-step title="入库结果" />
      </el-steps>

      <div v-if="imp.step === 1">
        <div class="upload-zone" :class="{ dragover: imp.drag }"
             @click="triggerImport" @dragover.prevent="imp.drag = true"
             @dragleave.prevent="imp.drag = false" @drop.prevent="onImportDrop">
          <div class="ic"><el-icon><UploadFilled /></el-icon></div>
          <div class="t">拖拽到货明细 / 送货单到此处，或点击选择</div>
          <div class="s">支持 .xlsx / .xls / .csv，单次最多 1000 行</div>
          <div class="hint">不需要固定模板：自动识别料号、型号、数量、单价、批次、库位、有效期</div>
        </div>
        <input ref="impFile" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onImportFile" />
        <div class="flex-between" style="margin-top:16px">
          <span class="muted" style="font-size:12px">系统按 料号 → 型号 自动匹配器件档案，未匹配行会标红并可跳过</span>
          <span class="pill blue no-dot">智能识别</span>
        </div>
      </div>

      <div v-else-if="imp.step === 2">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 14px">
          <el-form-item label="单据类型">
            <el-select v-model="imp.form.type" style="width:100%">
              <el-option label="采购入库" value="purchase" />
              <el-option label="生产退料" value="return" />
              <el-option label="其他入库" value="other" />
            </el-select>
          </el-form-item>
          <el-form-item label="供应商">
            <el-select v-model="imp.form.supplier_id" filterable clearable placeholder="可选" style="width:100%">
              <el-option v-for="s in Store.meta.suppliers" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="备注"><el-input v-model="imp.form.remark" placeholder="可选" /></el-form-item>
        </div>

        <div class="flex-between" style="margin-bottom:8px">
          <div class="flex gap-12">
            <span class="file-chip" style="padding:6px 10px"><el-icon><Document /></el-icon>{{ imp.fileName }}</span>
            <span class="pill blue no-dot">{{ imp.headerRow >= 0 ? '表头：第 ' + (imp.headerRow + 1) + ' 行' : '无表头模式' }}</span>
            <span class="pill green no-dot">匹配成功 {{ imp.rows.filter(r => r.component_id).length }} 行</span>
            <span v-if="imp.errors.length" class="pill red no-dot">待处理 {{ imp.errors.length }} 处</span>
          </div>
          <el-button text @click="imp.step = 1; imp.rows = []; imp.errors = []">重新选择</el-button>
        </div>

        <div class="map-tip" style="margin-bottom:8px">
          <el-icon><MagicStick /></el-icon>
          已自动识别 {{ Object.keys(imp.mapping).length }} 个字段，如识别有误可在下方调整
        </div>
        <div class="map-bar" style="margin-bottom:12px">
          <div class="map-field" v-for="f in importFields()" :key="f.key">
            <span class="lb">{{ f.label }}<span v-if="f.req" class="req">*</span></span>
            <el-select :model-value="imp.mapping[f.key]" size="small" clearable placeholder="未映射"
                       @change="setImportMap(f.key, $event)">
              <el-option v-for="(h, i) in imp.headers" :key="i" :label="(h || ('列' + (i + 1)))" :value="String(i)" />
            </el-select>
          </div>
        </div>

        <el-table :data="imp.rows" size="small" height="250" :row-class-name="rowClass" style="width:100%">
          <el-table-column label="行" width="46" align="center">
            <template #default="{ row }"><span class="muted-2">{{ row._line }}</span></template>
          </el-table-column>
          <el-table-column label="料号 / 型号" min-width="180">
            <template #default="{ row }">
              <div class="mono">{{ row.part_number || '—' }}</div>
              <div class="cell-sub">{{ row.model }}</div>
            </template>
          </el-table-column>
          <el-table-column label="匹配器件" min-width="210">
            <template #default="{ row }">
              <template v-if="row.matched">
                <div class="cell-main">{{ row.matched.name }}</div>
                <div class="cell-sub">{{ row.matched.part_number }} · {{ row.matched.brand }} {{ row.matched.model }}</div>
              </template>
              <span v-else class="muted-2">未匹配</span>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="86" align="right">
            <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtQty(row.quantity) }}</span></template>
          </el-table-column>
          <el-table-column label="单价" width="88" align="right">
            <template #default="{ row }"><span class="num">{{ row.unit_price ? fmtMoney(row.unit_price, 4) : '—' }}</span></template>
          </el-table-column>
          <el-table-column prop="batch_no" label="批次" width="118" show-overflow-tooltip>
            <template #default="{ row }"><span class="mono">{{ row.batch_no || '自动生成' }}</span></template>
          </el-table-column>
          <el-table-column prop="location" label="库位" width="86" />
          <el-table-column label="状态" width="112">
            <template #default="{ row }">
              <span v-if="!row._errors.length" class="pill green">匹配成功</span>
              <span v-else class="pill red">{{ row._errors[0] }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="flex-between" style="margin-top:12px">
          <el-checkbox v-model="imp.form.confirm">导入后立即确认入库（库存立即增加）</el-checkbox>
          <span class="muted-2" style="font-size:11.5px">未匹配行将被跳过，不生成单据明细</span>
        </div>
      </div>

      <div v-else>
        <div class="empty-box" style="padding:24px">
          <div class="ic" style="color:#059669"><el-icon><CircleCheckFilled /></el-icon></div>
          <div class="t" style="font-size:15px">{{ imp.result.confirmed ? '已一键入库' : '入库单已生成' }}</div>
          <div class="s">{{ imp.result.order_no }} · {{ imp.result.count }} 项 · 合计 {{ fmtQty(imp.result.total_qty) }}</div>
        </div>
        <el-alert type="info" :closable="false"
          :title="imp.result.confirmed ? '库存、批次与移动加权均价已更新，可在出入库流水查看。' : '单据为草稿状态，请到「入库管理」确认后才会增加库存。'" />
      </div>

      <template #footer>
        <el-button @click="imp.visible = false">{{ imp.step === 3 ? '完成' : '取消' }}</el-button>
        <el-button v-if="imp.step === 2" type="primary" :loading="imp.submitting"
                   :disabled="!imp.rows.some(r => r.component_id)" @click="submitImport">
          {{ imp.form.confirm ? '导入并一键入库' : '导入为入库单' }}
        </el-button>
        <el-button v-if="imp.step === 3" type="primary" @click="imp.visible = false; openDetail({ id: imp.result.id })">
          查看入库单
        </el-button>
      </template>
    </el-dialog>

    <!-- 新建单据 -->
    <el-dialog v-model="create.visible" :title="isInbound ? '新建入库单' : '新建出库单'" width="980px" append-to-body :close-on-click-modal="false">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 14px">
        <el-form-item label="单据类型">
          <el-select v-model="create.form.type" style="width:100%">
            <template v-if="isInbound">
              <el-option label="采购入库" value="purchase" />
              <el-option label="生产退料" value="return" />
              <el-option label="其他入库" value="other" />
            </template>
            <template v-else>
              <el-option label="生产领料" value="production" />
              <el-option label="借用出库" value="borrow" />
              <el-option label="报废出库" value="scrap" />
              <el-option label="其他出库" value="other" />
            </template>
          </el-select>
        </el-form-item>
        <el-form-item v-if="isInbound" label="供应商">
          <el-select v-model="create.form.supplier_id" filterable clearable placeholder="选择供应商" style="width:100%">
            <el-option v-for="s in Store.meta.suppliers" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="项目 / 用途">
          <el-input v-model="create.form.project" placeholder="如 GW-300 试产" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="create.form.remark" placeholder="选填" /></el-form-item>
      </div>

      <div class="flex-between" style="margin:4px 0 10px">
        <span class="section-title" style="margin:0">物料明细</span>
        <el-button size="small" @click="addItem"><el-icon><Plus /></el-icon>添加一行</el-button>
      </div>

      <el-table :data="create.items" size="small" style="width:100%">
        <el-table-column label="器件" min-width="250">
          <template #default="{ row }">
            <el-select v-model="row.component_id" filterable remote :remote-method="q => searchComp(row, q)"
                       :loading="row.loading" placeholder="搜索料号 / 型号" style="width:100%">
              <el-option v-for="c in row.options" :key="c.id" :label="c.part_number + ' · ' + c.name + ' / ' + (c.model||'')" :value="c.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="112">
          <template #default="{ row }"><el-input-number v-model="row.quantity" :min="1" size="small" :controls="false" style="width:92px" /></template>
        </el-table-column>
        <template v-if="isInbound">
          <el-table-column label="单价" width="112">
            <template #default="{ row }"><el-input-number v-model="row.unit_price" :min="0" :precision="4" size="small" :controls="false" style="width:92px" /></template>
          </el-table-column>
          <el-table-column label="批次号" width="150">
            <template #default="{ row }"><el-input v-model="row.batch_no" size="small" placeholder="留空自动生成" /></template>
          </el-table-column>
          <el-table-column label="库位" width="120">
            <template #default="{ row }"><el-input v-model="row.location" size="small" placeholder="如 A-01-02" /></template>
          </el-table-column>
          <el-table-column label="有效期" width="146">
            <template #default="{ row }">
              <el-date-picker v-model="row.expiry_date" type="date" size="small" value-format="YYYY-MM-DD" placeholder="选填" style="width:126px" />
            </template>
          </el-table-column>
        </template>
        <el-table-column v-else label="用途" min-width="150">
          <template #default="{ row }"><el-input v-model="row.purpose" size="small" placeholder="如 试产领料" /></template>
        </el-table-column>
        <el-table-column label="" width="46" align="center">
          <template #default="{ $index }">
            <el-button text type="danger" size="small" @click="removeItem($index)" :disabled="create.items.length === 1">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-alert type="info" :closable="false" style="margin-top:12px"
        :title="isInbound ? '新建后为草稿状态，确认入库才会增加库存并登记批次。' : '新建后为草稿状态；提交后预占库存，确认出库才实际扣减。'" />
      <template #footer>
        <el-button @click="create.visible = false">取消</el-button>
        <el-button type="primary" :loading="create.saving" @click="saveCreate">保存草稿</el-button>
      </template>
    </el-dialog>
  </div>
  `
};
