window.Pages = window.Pages || {};

const UNIT_SET = ['pcs', '个', '只', '卷', '罐', '盘', '套', 'kg', 'm'];

window.Pages['page-components'] = {
  name: 'page-components',
  data() {
    return {
      loading: false,
      list: [],
      total: 0,
      page: 1,
      pageSize: 15,
      stats: {},
      filters: { keyword: '', category_id: '', brand: '', lifecycle: '', warning: false },
      meta: { categories: [], brands: [], suppliers: [] },
      detail: { visible: false, loading: false, tab: 'batches', data: null },
      edit: { visible: false, saving: false, isNew: true, form: this.blankForm() },
      imp: {
        visible: false, step: 1, fileName: '', rows: [], errors: [],
        submitting: false, result: null, drag: false
      },
      sub: { visible: false, loading: false, options: [], component_id: null, type: 'full', remark: '' },
      supDlg: { visible: false, form: { supplier_id: '', price: 0, moq: 1, lead_time_days: 7, is_primary: 0 } }
    };
  },
  computed: {
    errorLines() { return new Set(this.imp.errors.map(e => e.line)); },
    validCount() { return this.imp.rows.length - this.imp.errors.length; }
  },
  methods: {
    fmtQty: Utils.fmtQty,
    fmtMoney: Utils.fmtMoney,
    pill: Utils.pill,
    fmtDate: Utils.fmtDate,
    fmtDateTime: Utils.fmtDateTime,
    blankForm() {
      return {
        id: null, part_number: '', name: '', brand: '', model: '', spec: '', package: '',
        unit: 'pcs', category_id: '', lifecycle: 'active', min_stock: 0, moq: 1,
        lead_time_days: 7, datasheet_url: '', remark: ''
      };
    },
    async load() {
      this.loading = true;
      try {
        const d = await Api.get('/components', {
          page: this.page, pageSize: this.pageSize,
          keyword: this.filters.keyword,
          category_id: this.filters.category_id,
          brand: this.filters.brand,
          lifecycle: this.filters.lifecycle,
          warning: this.filters.warning ? 1 : ''
        });
        this.list = d.list;
        this.total = d.total;
        this.stats = d.stats;
      } finally { this.loading = false; }
    },
    async loadMeta() {
      const d = await Api.get('/components/meta', null, { silent: true });
      this.meta = d;
      Store.meta = d;
    },
    search() { this.page = 1; this.load(); },
    reset() {
      this.filters = { keyword: '', category_id: '', brand: '', lifecycle: '', warning: false };
      this.page = 1;
      this.load();
    },
    onPage(p) { this.page = p; this.load(); },
    openDetail(row) {
      this.detail.visible = true;
      this.detail.tab = 'batches';
      this.detail.data = null;
      this.loadDetail(row.id);
    },
    async loadDetail(id) {
      this.detail.loading = true;
      try {
        this.detail.data = await Api.get('/components/' + id);
      } finally { this.detail.loading = false; }
    },
    openCreate() {
      this.edit.isNew = true;
      this.edit.form = this.blankForm();
      this.edit.visible = true;
    },
    openEdit(row) {
      this.edit.isNew = false;
      this.edit.form = { ...this.blankForm(), ...row, category_id: row.category_id || '' };
      this.edit.visible = true;
    },
    async save() {
      const f = this.edit.form;
      if (!f.part_number || !f.name) return Api.toast('料号与名称必填', 'warning');
      this.edit.saving = true;
      try {
        if (this.edit.isNew) await Api.post('/components', f);
        else await Api.put('/components/' + f.id, f);
        Api.toast('保存成功', 'success');
        this.edit.visible = false;
        this.load();
        if (this.detail.visible && this.detail.data) this.loadDetail(this.detail.data.component.id);
      } catch (e) { /* handled */ } finally { this.edit.saving = false; }
    },
    async remove(row) {
      try {
        await this.$confirm(`确认停用器件「${row.part_number} ${row.name}」？停用后不会再出现在 BOM 匹配与库存列表中。`, '停用器件', {
          type: 'warning', confirmButtonText: '确认停用', cancelButtonText: '取消'
        });
      } catch (e) { return; }
      try {
        await Api.del('/components/' + row.id);
        Api.toast('器件已停用', 'success');
        this.load();
      } catch (e) { /* handled */ }
    },
    // ---------- 导入 ----------
    openImport() {
      this.imp = { visible: true, step: 1, fileName: '', rows: [], errors: [], submitting: false, result: null, drag: false };
    },
    triggerFile() { this.$refs.fileInput && this.$refs.fileInput.click(); },
    onFilePick(e) {
      const f = e.target.files && e.target.files[0];
      if (f) this.parseFile(f);
      e.target.value = '';
    },
    onDrop(e) {
      this.imp.drag = false;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) this.parseFile(f);
    },
    async parseFile(file) {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return Api.toast('请上传 .xlsx / .xls / .csv 文件', 'warning');
      this.imp.fileName = file.name;
      let raw;
      try { raw = await Utils.readSheet(file); }
      catch (e) { return Api.toast('文件解析失败，请检查格式'); }
      if (!raw.length) return Api.toast('文件中没有数据行', 'warning');

      const rows = raw.map((r, i) => {
        const row = {
          _line: i + 2,
          part_number: String(Utils.pick(r, ['料号', '料号*', 'part_number', 'Part Number'])).trim(),
          name: String(Utils.pick(r, ['名称', '名称*', 'name', '器件名称'])).trim(),
          brand: String(Utils.pick(r, ['品牌', 'brand'])).trim(),
          model: String(Utils.pick(r, ['原厂型号', '型号', 'model'])).trim(),
          spec: String(Utils.pick(r, ['规格参数', '规格', 'spec'])).trim(),
          package: String(Utils.pick(r, ['封装', 'package'])).trim(),
          unit: String(Utils.pick(r, ['单位', 'unit']) || 'pcs').trim(),
          category: String(Utils.pick(r, ['分类', 'category'])).trim(),
          min_stock: Number(Utils.pick(r, ['安全库存', 'min_stock']) || 0),
          remark: String(Utils.pick(r, ['备注', 'remark'])).trim()
        };
        const errs = [];
        if (!row.part_number) errs.push('料号必填');
        if (!row.name) errs.push('名称必填');
        if (!UNIT_SET.includes(row.unit)) errs.push(`单位「${row.unit}」不合法`);
        if (!(row.min_stock >= 0)) errs.push('安全库存需为非负数');
        row._errors = errs;
        return row;
      });
      const errors = [];
      rows.forEach(r => r._errors.forEach(m => errors.push({ line: r._line, message: m })));
      this.imp.rows = rows;
      this.imp.errors = errors;
      this.imp.step = 2;
    },
    rowClass({ row }) { return row._errors && row._errors.length ? 'row-warning' : ''; },
    async submitImport() {
      if (this.imp.errors.length) return Api.toast('存在错误行，请先修正后再提交', 'warning');
      this.imp.submitting = true;
      try {
        const payload = this.imp.rows.map(r => ({
          part_number: r.part_number, name: r.name, brand: r.brand, model: r.model,
          spec: r.spec, package: r.package, unit: r.unit, category: r.category,
          min_stock: r.min_stock, remark: r.remark
        }));
        const d = await Api.post('/components/import', { rows: payload });
        this.imp.result = d;
        this.imp.step = 3;
        this.load();
        this.loadMeta();
      } catch (e) { /* handled */ } finally { this.imp.submitting = false; }
    },
    downloadTemplate() {
      Utils.exportSheet([
        ['料号*', '名称*', '品牌', '原厂型号', '规格参数', '封装', '单位', '分类', '安全库存', '备注'],
        ['R-0603-10K-1', '贴片电阻', 'YAGEO', 'RC0603FR-0710KL', '10KΩ ±1% 1/10W', '0603', 'pcs', '电阻', 5000, ''],
        ['U-STM32F103C8T6', '32位 MCU', 'ST', 'STM32F103C8T6', 'Cortex-M3 72MHz 64KB', 'LQFP-48', 'pcs', 'MCU/处理器', 300, '示例行']
      ], '器件导入模板.xlsx', '器件档案');
    },
    exportList() {
      Api.get('/components', { page: 1, pageSize: 500 }).then(d => {
        const head = ['料号', '名称', '品牌', '原厂型号', '规格参数', '封装', '单位', '分类', '库存', '可用', '在途', '安全库存', '均价', '库存金额', '生命周期'];
        const rows = d.list.map(c => [c.part_number, c.name, c.brand, c.model, c.spec, c.package, c.unit,
          c.category_name || '', c.quantity, c.available, c.in_transit, c.min_stock, c.avg_price, c.stock_value,
          Utils.pill(c.lifecycle).text]);
        Utils.exportSheet([head, ...rows], '器件档案.xlsx', '器件档案');
      });
    },
    // ---------- 替代料 ----------
    async openSub() {
      this.sub.visible = true;
      this.sub.component_id = null;
      this.sub.type = 'full';
      this.sub.remark = '';
      this.sub.options = [];
      this.searchComponents('');
    },
    async searchComponents(q) {
      this.sub.loading = true;
      try {
        const d = await Api.get('/components', { keyword: q, page: 1, pageSize: 20 });
        const cur = this.detail.data?.component?.id;
        this.sub.options = d.list.filter(x => x.id !== cur);
      } finally { this.sub.loading = false; }
    },
    async addSub() {
      if (!this.sub.component_id) return Api.toast('请选择替代料', 'warning');
      try {
        await Api.post(`/components/${this.detail.data.component.id}/substitutes`, {
          substitute_id: this.sub.component_id, type: this.sub.type, remark: this.sub.remark
        });
        Api.toast('替代料已添加', 'success');
        this.sub.visible = false;
        this.loadDetail(this.detail.data.component.id);
      } catch (e) { /* handled */ }
    },
    async delSub(row) {
      try {
        await Api.del(`/components/${this.detail.data.component.id}/substitutes/${row.id}`);
        Api.toast('已删除', 'success');
        this.loadDetail(this.detail.data.component.id);
      } catch (e) { /* handled */ }
    },
    openSup() {
      this.supDlg.form = { supplier_id: '', price: 0, moq: 1, lead_time_days: 7, is_primary: 0 };
      this.supDlg.visible = true;
    },
    async addSup() {
      const f = this.supDlg.form;
      if (!f.supplier_id) return Api.toast('请选择供应商', 'warning');
      try {
        await Api.post(`/components/${this.detail.data.component.id}/suppliers`, f);
        Api.toast('供应商已关联', 'success');
        this.supDlg.visible = false;
        this.loadDetail(this.detail.data.component.id);
      } catch (e) { /* handled */ }
    },
    async delSup(row) {
      try {
        await Api.del(`/components/${this.detail.data.component.id}/suppliers/${row.id}`);
        this.loadDetail(this.detail.data.component.id);
      } catch (e) { /* handled */ }
    }
  },
  mounted() {
    if (location.hash.includes('warning=1')) this.filters.warning = true;
    this.loadMeta();
    this.load();
  },
  template: `
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>器件档案</h1>
        <p class="page-sub">维护料号、品牌、型号、封装、安全库存等基础信息</p>
      </div>
      <div class="page-actions">
        <el-button @click="downloadTemplate"><el-icon><Download /></el-icon>模板</el-button>
        <el-button @click="exportList"><el-icon><Files /></el-icon>导出</el-button>
        <el-button v-if="can('comp:import')" @click="openImport"><el-icon><Upload /></el-icon>批量导入</el-button>
        <el-button v-if="can('comp:write')" type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新增器件</el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input v-model="filters.keyword" placeholder="搜索料号 / 名称 / 型号 / 品牌" clearable @keyup.enter="search" @clear="search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="filters.category_id" placeholder="全部分类" clearable @change="search">
        <el-option v-for="c in meta.categories" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.brand" placeholder="全部品牌" clearable filterable @change="search">
        <el-option v-for="b in meta.brands" :key="b" :label="b" :value="b" />
      </el-select>
      <el-select v-model="filters.lifecycle" placeholder="生命周期" clearable @change="search" style="width:130px">
        <el-option label="量产" value="active" />
        <el-option label="不推荐" value="nrnd" />
        <el-option label="停产" value="eol" />
      </el-select>
      <el-checkbox v-model="filters.warning" @change="search" style="margin-left:2px">仅看预警</el-checkbox>
      <div class="spacer"></div>
      <el-button @click="reset">重置</el-button>
      <el-button type="primary" @click="search">查询</el-button>
    </div>

    <div class="stat-strip">
      <div class="stat-item"><div class="l">器件总数</div><div class="v">{{ fmtQty(stats.total) }}<small>项</small></div></div>
      <div class="stat-item"><div class="l">安全库存预警</div><div class="v danger">{{ stats.warning || 0 }}<small>项</small></div></div>
      <div class="stat-item"><div class="l">库存总量</div><div class="v">{{ fmtQty(stats.total_qty) }}<small>件</small></div></div>
      <div class="stat-item"><div class="l">库存总值</div><div class="v">{{ fmtMoney(stats.total_value) }}</div></div>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" style="width:100%" :row-class-name="({row}) => row.warning ? 'row-warning' : ''">
        <el-table-column label="料号" min-width="150" fixed>
          <template #default="{ row }">
            <span class="mono hover-link" @click="openDetail(row)">{{ row.part_number }}</span>
          </template>
        </el-table-column>
        <el-table-column label="器件名称 / 型号" min-width="200">
          <template #default="{ row }">
            <div class="cell-main">{{ row.name }}</div>
            <div class="cell-sub">{{ row.brand }} · {{ row.model || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="package" label="封装" width="90">
          <template #default="{ row }"><span class="mono">{{ row.package || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="category_name" label="分类" width="96">
          <template #default="{ row }">{{ row.category_name || '未分类' }}</template>
        </el-table-column>
        <el-table-column label="现有库存" width="112" align="right">
          <template #default="{ row }">
            <div class="num" :class="{ danger: row.warning }" style="font-weight:600">{{ fmtQty(row.quantity) }}</div>
            <div class="cell-sub">{{ row.unit }}</div>
          </template>
        </el-table-column>
        <el-table-column label="在途" width="80" align="right">
          <template #default="{ row }"><span class="num" :class="{ 'muted-2': !row.in_transit }">{{ fmtQty(row.in_transit) }}</span></template>
        </el-table-column>
        <el-table-column label="安全库存" width="92" align="right">
          <template #default="{ row }"><span class="num muted">{{ fmtQty(row.min_stock) }}</span></template>
        </el-table-column>
        <el-table-column label="库存金额" width="104" align="right">
          <template #default="{ row }"><span class="num">{{ fmtMoney(row.stock_value) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="102" align="center">
          <template #default="{ row }">
            <span class="pill" :class="row.warning ? 'red' : 'green'">{{ row.warning ? '需补货' : '正常' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="112" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="can('comp:write')" link type="primary" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <span class="info">共 {{ total }} 条记录</span>
        <el-pagination background layout="prev, pager, next, sizes" :total="total"
          v-model:current-page="page" v-model:page-size="pageSize"
          :page-sizes="[15, 30, 50, 100]" @current-change="onPage" @size-change="search" />
      </div>
    </div>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detail.visible" size="740px" :with-header="true" title="器件详情" destroy-on-close>
      <div v-loading="detail.loading">
        <template v-if="detail.data">
          <div class="detail-hero">
            <div class="pn">{{ detail.data.component.part_number }}</div>
            <h3>{{ detail.data.component.name }}</h3>
            <div class="detail-tags">
              <span class="pill" :class="pill(detail.data.component.lifecycle).color">{{ pill(detail.data.component.lifecycle).text }}</span>
              <span class="pill gray no-dot">{{ detail.data.component.category_name || '未分类' }}</span>
              <span class="pill gray no-dot">{{ detail.data.component.brand }}</span>
              <span class="pill gray no-dot">{{ detail.data.component.package }}</span>
              <span v-if="detail.data.component.warning" class="pill red">低于安全库存</span>
            </div>
            <div class="detail-kpis">
              <div class="detail-kpi"><div class="l">现有库存</div><div class="v">{{ fmtQty(detail.data.component.quantity) }} <small class="muted-2" style="font-size:11px">{{ detail.data.component.unit }}</small></div></div>
              <div class="detail-kpi"><div class="l">可用库存</div><div class="v">{{ fmtQty(detail.data.component.available) }}</div></div>
              <div class="detail-kpi"><div class="l">已预留</div><div class="v">{{ fmtQty(detail.data.component.reserved) }}</div></div>
              <div class="detail-kpi"><div class="l">在途</div><div class="v">{{ fmtQty(detail.data.component.in_transit) }}</div></div>
              <div class="detail-kpi"><div class="l">安全库存</div><div class="v">{{ fmtQty(detail.data.component.min_stock) }}</div></div>
              <div class="detail-kpi"><div class="l">库存金额</div><div class="v">{{ fmtMoney(detail.data.component.stock_value) }}</div></div>
            </div>
          </div>

          <div style="padding:0 22px 22px">
            <el-tabs v-model="detail.tab">
              <el-tab-pane label="批次库存" name="batches">
                <el-table :data="detail.data.batches" size="small" style="width:100%">
                  <el-table-column prop="batch_no" label="批次号" min-width="130">
                    <template #default="{ row }"><span class="mono">{{ row.batch_no }}</span></template>
                  </el-table-column>
                  <el-table-column prop="location" label="库位" width="92" />
                  <el-table-column label="数量" width="90" align="right">
                    <template #default="{ row }"><span class="num">{{ fmtQty(row.quantity) }}</span></template>
                  </el-table-column>
                  <el-table-column label="单价" width="92" align="right">
                    <template #default="{ row }"><span class="num">{{ fmtMoney(row.unit_price, 4) }}</span></template>
                  </el-table-column>
                  <el-table-column prop="supplier_name" label="供应商" min-width="130" show-overflow-tooltip />
                  <el-table-column label="有效期" width="100">
                    <template #default="{ row }">{{ row.expiry_date ? fmtDate(row.expiry_date) : '—' }}</template>
                  </el-table-column>
                </el-table>
                <div v-if="!detail.data.batches.length" class="empty-box"><div class="s">暂无批次库存</div></div>
              </el-tab-pane>

              <el-tab-pane label="库存流水" name="tx">
                <el-table :data="detail.data.transactions" size="small" style="width:100%">
                  <el-table-column label="时间" width="132">
                    <template #default="{ row }"><span class="muted">{{ fmtDateTime(row.created_at) }}</span></template>
                  </el-table-column>
                  <el-table-column label="类型" width="72">
                    <template #default="{ row }">
                      <span class="pill" :class="row.quantity > 0 ? 'green' : 'amber'">{{ row.quantity > 0 ? '入库' : '出库' }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="数量" width="88" align="right">
                    <template #default="{ row }"><span class="num" :class="row.quantity > 0 ? 'ok' : 'danger'">{{ row.quantity > 0 ? '+' : '' }}{{ fmtQty(row.quantity) }}</span></template>
                  </el-table-column>
                  <el-table-column label="结存" width="80" align="right">
                    <template #default="{ row }"><span class="num muted">{{ fmtQty(row.after_qty) }}</span></template>
                  </el-table-column>
                  <el-table-column prop="ref_no" label="关联单号" min-width="140">
                    <template #default="{ row }"><span class="mono">{{ row.ref_no || '—' }}</span></template>
                  </el-table-column>
                  <el-table-column prop="operator_name" label="操作人" width="80" />
                </el-table>
                <div v-if="!detail.data.transactions.length" class="empty-box"><div class="s">暂无流水</div></div>
              </el-tab-pane>

              <el-tab-pane label="供应商" name="suppliers">
                <div class="flex-between" style="margin-bottom:10px">
                  <span class="muted" style="font-size:12px">主供应商优先用于采购订单拆分</span>
                  <el-button v-if="can('comp:write')" size="small" @click="openSup"><el-icon><Plus /></el-icon>关联供应商</el-button>
                </div>
                <el-table :data="detail.data.suppliers" size="small" style="width:100%">
                  <el-table-column prop="supplier_name" label="供应商" min-width="160" show-overflow-tooltip />
                  <el-table-column label="报价" width="100" align="right">
                    <template #default="{ row }"><span class="num">{{ fmtMoney(row.price, 4) }}</span></template>
                  </el-table-column>
                  <el-table-column prop="moq" label="MOQ" width="80" align="right" />
                  <el-table-column prop="lead_time_days" label="交期(天)" width="86" align="right" />
                  <el-table-column label="主供" width="66" align="center">
                    <template #default="{ row }"><span v-if="row.is_primary" class="pill blue">主供</span><span v-else class="muted-2">—</span></template>
                  </el-table-column>
                  <el-table-column label="操作" width="66" align="center">
                    <template #default="{ row }">
                      <el-button v-if="can('comp:write')" link type="danger" @click="delSup(row)">解除</el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <div v-if="!detail.data.suppliers.length" class="empty-box"><div class="s">尚未关联供应商</div></div>
              </el-tab-pane>

              <el-tab-pane label="替代料" name="subs">
                <div class="flex-between" style="margin-bottom:10px">
                  <span class="muted" style="font-size:12px">缺料分析时会合并计算替代料可用量</span>
                  <el-button v-if="can('comp:write')" size="small" @click="openSub"><el-icon><Plus /></el-icon>添加替代料</el-button>
                </div>
                <el-table :data="detail.data.substitutes" size="small" style="width:100%">
                  <el-table-column label="替代料号" min-width="150">
                    <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
                  </el-table-column>
                  <el-table-column prop="name" label="名称" min-width="120" />
                  <el-table-column prop="model" label="型号" min-width="140" show-overflow-tooltip />
                  <el-table-column label="可用量" width="90" align="right">
                    <template #default="{ row }"><span class="num">{{ fmtQty(row.quantity) }}</span></template>
                  </el-table-column>
                  <el-table-column label="类型" width="96">
                    <template #default="{ row }"><span class="pill" :class="row.type === 'full' ? 'green' : 'amber'">{{ row.type === 'full' ? '完全替代' : '有条件' }}</span></template>
                  </el-table-column>
                  <el-table-column label="操作" width="66" align="center">
                    <template #default="{ row }">
                      <el-button v-if="can('comp:write')" link type="danger" @click="delSub(row)">移除</el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <div v-if="!detail.data.substitutes.length" class="empty-box"><div class="s">暂无替代料</div></div>
              </el-tab-pane>
            </el-tabs>

            <div class="soft-divider"></div>
            <el-descriptions :column="3" size="small" border>
              <el-descriptions-item label="原厂型号">{{ detail.data.component.model || '—' }}</el-descriptions-item>
              <el-descriptions-item label="规格参数">{{ detail.data.component.spec || '—' }}</el-descriptions-item>
              <el-descriptions-item label="MOQ">{{ detail.data.component.moq }}</el-descriptions-item>
              <el-descriptions-item label="交期">{{ detail.data.component.lead_time_days }} 天</el-descriptions-item>
              <el-descriptions-item label="创建时间">{{ fmtDateTime(detail.data.component.created_at) }}</el-descriptions-item>
              <el-descriptions-item label="更新时间">{{ fmtDateTime(detail.data.component.updated_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </template>
      </div>
      <template #footer>
        <div class="flex-between">
          <el-button v-if="can('comp:delete') && detail.data" type="danger" plain @click="remove(detail.data.component)">停用器件</el-button>
          <span v-else></span>
          <div>
            <el-button @click="detail.visible = false">关闭</el-button>
            <el-button v-if="can('comp:write') && detail.data" type="primary" @click="openEdit(detail.data.component)">编辑器件</el-button>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="edit.visible" :title="edit.isNew ? '新增器件' : '编辑器件'" width="640px" append-to-body>
      <el-form label-position="top">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
          <el-form-item label="料号" required><el-input v-model="edit.form.part_number" placeholder="如 R-0603-10K-1" :disabled="!edit.isNew" /></el-form-item>
          <el-form-item label="器件名称" required><el-input v-model="edit.form.name" placeholder="如 贴片电阻" /></el-form-item>
          <el-form-item label="品牌"><el-input v-model="edit.form.brand" placeholder="如 YAGEO" /></el-form-item>
          <el-form-item label="原厂型号"><el-input v-model="edit.form.model" placeholder="如 RC0603FR-0710KL" /></el-form-item>
          <el-form-item label="规格参数"><el-input v-model="edit.form.spec" placeholder="如 10KΩ ±1% 1/10W" /></el-form-item>
          <el-form-item label="封装"><el-input v-model="edit.form.package" placeholder="如 0603" /></el-form-item>
          <el-form-item label="单位">
            <el-select v-model="edit.form.unit" style="width:100%">
              <el-option v-for="u in ['pcs','个','只','卷','罐','盘','套','kg','m']" :key="u" :label="u" :value="u" />
            </el-select>
          </el-form-item>
          <el-form-item label="分类">
            <el-select v-model="edit.form.category_id" style="width:100%" clearable placeholder="选择分类">
              <el-option v-for="c in meta.categories" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="安全库存"><el-input-number v-model="edit.form.min_stock" :min="0" :step="100" style="width:100%" /></el-form-item>
          <el-form-item label="最小起订量 MOQ"><el-input-number v-model="edit.form.moq" :min="1" style="width:100%" /></el-form-item>
          <el-form-item label="交期（天）"><el-input-number v-model="edit.form.lead_time_days" :min="1" style="width:100%" /></el-form-item>
          <el-form-item label="生命周期">
            <el-select v-model="edit.form.lifecycle" style="width:100%">
              <el-option label="量产 (Active)" value="active" />
              <el-option label="不推荐 (NRND)" value="nrnd" />
              <el-option label="停产 (EOL)" value="eol" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="edit.form.remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edit.visible = false">取消</el-button>
        <el-button type="primary" :loading="edit.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入 -->
    <el-dialog v-model="imp.visible" title="批量导入器件档案" width="980px" append-to-body :close-on-click-modal="false">
      <el-steps :active="imp.step - 1" align-center finish-status="success" style="margin-bottom:24px">
        <el-step title="上传文件" description="Excel / CSV" />
        <el-step title="预览校验" description="错误行标红" />
        <el-step title="导入结果" description="新增 / 更新" />
      </el-steps>

      <div v-if="imp.step === 1">
        <div class="upload-zone" :class="{ dragover: imp.drag }"
             @click="triggerFile"
             @dragover.prevent="imp.drag = true" @dragleave.prevent="imp.drag = false" @drop.prevent="onDrop">
          <div class="ic"><el-icon><UploadFilled /></el-icon></div>
          <div class="t">拖拽 Excel 文件到此处，或点击选择</div>
          <div class="s">支持 .xlsx / .xls / .csv，单次最多 5000 行</div>
          <div class="hint">料号已存在则更新，不存在则新增，并自动初始化库存记录</div>
        </div>
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onFilePick" />
        <div class="flex-between" style="margin-top:16px">
          <span class="muted" style="font-size:12px">首次导入建议先下载模板，按表头填写</span>
          <el-button text type="primary" @click="downloadTemplate"><el-icon><Download /></el-icon>下载导入模板</el-button>
        </div>
      </div>

      <div v-else-if="imp.step === 2">
        <div class="flex-between" style="margin-bottom:12px">
          <div class="flex gap-12">
            <span class="file-chip" style="padding:6px 10px"><el-icon><Document /></el-icon>{{ imp.fileName }}</span>
            <span class="pill green no-dot">可导入 {{ validCount }} 行</span>
            <span v-if="imp.errors.length" class="pill red no-dot">错误 {{ imp.errors.length }} 处</span>
          </div>
          <el-button text @click="imp.step = 1; imp.rows = []; imp.errors = []">重新选择</el-button>
        </div>
        <el-alert v-if="imp.errors.length" type="error" :closable="false" style="margin-bottom:12px"
          :title="'存在 ' + imp.errors.length + ' 处校验错误：' + imp.errors.slice(0,4).map(e => '第' + e.line + '行 ' + e.message).join('；') + (imp.errors.length > 4 ? ' …' : '')" />
        <el-table :data="imp.rows" size="small" height="330" :row-class-name="rowClass" style="width:100%">
          <el-table-column label="行" width="46" align="center">
            <template #default="{ row }"><span class="muted-2">{{ row._line }}</span></template>
          </el-table-column>
          <el-table-column prop="part_number" label="料号" width="136">
            <template #default="{ row }"><span class="mono">{{ row.part_number || '—' }}</span></template>
          </el-table-column>
          <el-table-column prop="name" label="名称" width="104" />
          <el-table-column prop="brand" label="品牌" width="86" />
          <el-table-column prop="model" label="原厂型号" min-width="136" show-overflow-tooltip />
          <el-table-column prop="package" label="封装" width="72" />
          <el-table-column prop="unit" label="单位" width="58" />
          <el-table-column prop="category" label="分类" width="86" />
          <el-table-column prop="min_stock" label="安全库存" width="82" align="right" />
          <el-table-column label="校验" width="128">
            <template #default="{ row }">
              <span v-if="!row._errors.length" class="pill green">通过</span>
              <span v-else class="pill red">{{ row._errors[0] }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-else>
        <div class="empty-box" style="padding:26px 20px">
          <div class="ic" style="color:#059669"><el-icon><CircleCheckFilled /></el-icon></div>
          <div class="t" style="font-size:15px">导入完成</div>
          <div class="s">共处理 {{ imp.result.total }} 条数据</div>
        </div>
        <div class="detail-kpis" style="grid-template-columns:repeat(3,1fr);margin-top:0">
          <div class="detail-kpi"><div class="l">新增</div><div class="v ok">{{ imp.result.created }}</div></div>
          <div class="detail-kpi"><div class="l">更新</div><div class="v">{{ imp.result.updated }}</div></div>
          <div class="detail-kpi"><div class="l">失败</div><div class="v" :class="{ danger: imp.result.failed.length }">{{ imp.result.failed.length }}</div></div>
        </div>
        <div v-if="imp.result.failed.length" style="margin-top:14px">
          <el-alert v-for="(f, i) in imp.result.failed.slice(0, 10)" :key="i" type="error" :closable="false"
            :title="'第 ' + f.row + ' 行：' + f.message" style="margin-bottom:6px" />
        </div>
      </div>

      <template #footer>
        <el-button @click="imp.visible = false">{{ imp.step === 3 ? '完成' : '取消' }}</el-button>
        <el-button v-if="imp.step === 2" type="primary" :loading="imp.submitting" :disabled="imp.errors.length > 0" @click="submitImport">
          确认导入 {{ validCount }} 行
        </el-button>
      </template>
    </el-dialog>

    <!-- 添加替代料 -->
    <el-dialog v-model="sub.visible" title="添加替代料" width="480px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="选择替代器件" required>
          <el-select v-model="sub.component_id" filterable remote :remote-method="searchComponents"
                     :loading="sub.loading" placeholder="输入料号 / 型号搜索" style="width:100%">
            <el-option v-for="c in sub.options" :key="c.id" :label="c.part_number + ' · ' + c.name + ' / ' + (c.model||'')" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="替代类型">
          <el-radio-group v-model="sub.type">
            <el-radio-button value="full">完全替代</el-radio-button>
            <el-radio-button value="conditional">有条件替代</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="替代说明"><el-input v-model="sub.remark" type="textarea" :rows="2" placeholder="如：需调整反馈电阻，仅限应急" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="sub.visible = false">取消</el-button>
        <el-button type="primary" @click="addSub">添加</el-button>
      </template>
    </el-dialog>

    <!-- 关联供应商 -->
    <el-dialog v-model="supDlg.visible" title="关联供应商" width="480px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="供应商" required>
          <el-select v-model="supDlg.form.supplier_id" filterable placeholder="选择供应商" style="width:100%">
            <el-option v-for="s in meta.suppliers" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
          <el-form-item label="报价（元）"><el-input-number v-model="supDlg.form.price" :min="0" :precision="4" :step="0.1" style="width:100%" /></el-form-item>
          <el-form-item label="MOQ"><el-input-number v-model="supDlg.form.moq" :min="1" style="width:100%" /></el-form-item>
          <el-form-item label="交期（天）"><el-input-number v-model="supDlg.form.lead_time_days" :min="1" style="width:100%" /></el-form-item>
          <el-form-item label="设为主供"><el-switch v-model="supDlg.form.is_primary" :active-value="1" :inactive-value="0" /></el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="supDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="addSup">保存</el-button>
      </template>
    </el-dialog>
  </div>
  `
};
