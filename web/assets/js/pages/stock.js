window.Pages = window.Pages || {};

window.Pages['page-stock'] = {
  name: 'page-stock',
  data() {
    return {
      tab: 'query',
      loading: false,
      list: [],
      total: 0,
      page: 1,
      pageSize: 15,
      stats: {},
      filters: { keyword: '', category_id: '', only_warning: false },
      txLoading: false,
      txList: [],
      txTotal: 0,
      txPage: 1,
      txPageSize: 15,
      txStats: {},
      txFilters: { keyword: '', type: '', range: [] },
      checkLoading: false,
      checks: [],
      checkTotal: 0,
      checkPage: 1,
      checkPageSize: 10,
      adjust: { visible: false, row: null, quantity: 0, remark: '', saving: false },
      checkCreate: { visible: false, scope: '', category_id: '', remark: '', saving: false },
      checkDetail: { visible: false, loading: false, data: null, saving: false }
    };
  },
  methods: {
    fmtQty: Utils.fmtQty,
    fmtMoney: Utils.fmtMoney,
    fmtDateTime: Utils.fmtDateTime,
    pill: Utils.pill,
    diffOf(row) { return Number(row.actual_qty || 0) - Number(row.book_qty || 0); },
    async loadStock() {
      this.loading = true;
      try {
        const d = await Api.get('/stock', {
          page: this.page, pageSize: this.pageSize,
          keyword: this.filters.keyword, category_id: this.filters.category_id,
          only_warning: this.filters.only_warning ? 1 : ''
        });
        this.list = d.list;
        this.total = d.total;
        this.stats = d.stats;
      } finally { this.loading = false; }
    },
    searchStock() { this.page = 1; this.loadStock(); },
    resetStock() {
      this.filters = { keyword: '', category_id: '', only_warning: false };
      this.page = 1;
      this.loadStock();
    },
    async loadTx() {
      this.txLoading = true;
      try {
        const d = await Api.get('/stock/transactions', {
          page: this.txPage, pageSize: this.txPageSize,
          keyword: this.txFilters.keyword, type: this.txFilters.type,
          start: this.txFilters.range?.[0] || '', end: this.txFilters.range?.[1] || ''
        });
        this.txList = d.list;
        this.txTotal = d.total;
        this.txStats = d.stats;
      } finally { this.txLoading = false; }
    },
    async loadChecks() {
      this.checkLoading = true;
      try {
        const d = await Api.get('/stock/checks', { page: this.checkPage, pageSize: this.checkPageSize });
        this.checks = d.list;
        this.checkTotal = d.total;
      } finally { this.checkLoading = false; }
    },
    switchTab(name) {
      if (name === 'query') this.loadStock();
      if (name === 'tx') this.loadTx();
      if (name === 'check') this.loadChecks();
    },
    openAdjust(row) {
      this.adjust.row = row;
      this.adjust.quantity = 0;
      this.adjust.remark = '';
      this.adjust.visible = true;
    },
    async saveAdjust() {
      if (!this.adjust.quantity) return Api.toast('请输入调整数量（可为负数）', 'warning');
      this.adjust.saving = true;
      try {
        await Api.post('/stock/adjust', {
          component_id: this.adjust.row.component_id,
          quantity: this.adjust.quantity,
          remark: this.adjust.remark
        });
        Api.toast('库存调整成功', 'success');
        this.adjust.visible = false;
        this.loadStock();
      } catch (e) { /* handled */ } finally { this.adjust.saving = false; }
    },
    openCheckCreate() {
      this.checkCreate = { visible: true, scope: '', category_id: '', remark: '', saving: false };
    },
    async createCheck() {
      if (!this.checkCreate.scope) return Api.toast('请填写盘点范围', 'warning');
      this.checkCreate.saving = true;
      try {
        const d = await Api.post('/stock/checks', {
          scope: this.checkCreate.scope,
          category_id: this.checkCreate.category_id,
          remark: this.checkCreate.remark
        });
        Api.toast('盘点单已创建', 'success');
        this.checkCreate.visible = false;
        this.loadChecks();
        this.openCheck({ id: d.id });
      } catch (e) { /* handled */ } finally { this.checkCreate.saving = false; }
    },
    async openCheck(row) {
      this.checkDetail.visible = true;
      this.checkDetail.loading = true;
      this.checkDetail.data = null;
      try {
        this.checkDetail.data = await Api.get('/stock/checks/' + row.id);
      } finally { this.checkDetail.loading = false; }
    },
    async saveCheckItems() {
      const d = this.checkDetail.data;
      this.checkDetail.saving = true;
      try {
        await Api.put(`/stock/checks/${d.check.id}/items`, {
          items: d.items.map(i => ({ id: i.id, actual_qty: i.actual_qty, book_qty: i.book_qty }))
        });
        Api.toast('盘点数据已保存', 'success');
        this.openCheck({ id: d.check.id });
        this.loadChecks();
      } catch (e) { /* handled */ } finally { this.checkDetail.saving = false; }
    },
    async finishCheck() {
      const d = this.checkDetail.data;
      try {
        await this.$confirm('确认完成盘点？系统将按实盘数量生成差异调整流水，并更新库存。', '完成盘点', {
          type: 'warning', confirmButtonText: '确认完成', cancelButtonText: '再核对一下'
        });
      } catch (e) { return; }
      try {
        const r = await Api.post(`/stock/checks/${d.check.id}/finish`);
        Api.toast(r.adjusted ? `盘点完成，已调整 ${r.adjusted} 项` : '盘点完成，无差异', 'success');
        this.checkDetail.visible = false;
        this.loadChecks();
        this.loadStock();
      } catch (e) { /* handled */ }
    },
    exportStock() {
      Api.get('/stock', { page: 1, pageSize: 500, keyword: this.filters.keyword, category_id: this.filters.category_id })
        .then(d => {
          const head = ['料号', '名称', '品牌', '型号', '封装', '分类', '单位', '现有库存', '可用', '预留', '在途', '安全库存', '均价', '库存金额'];
          Utils.exportSheet([head, ...d.list.map(c => [c.part_number, c.name, c.brand, c.model, c.package,
            c.category_name || '', c.unit, c.quantity, c.available, c.reserved, c.in_transit, c.min_stock,
            c.avg_price, c.stock_value])], '库存快照.xlsx', '库存');
        });
    },
    exportTx() {
      Api.get('/stock/transactions', {
        page: 1, pageSize: 500, keyword: this.txFilters.keyword, type: this.txFilters.type,
        start: this.txFilters.range?.[0] || '', end: this.txFilters.range?.[1] || ''
      }).then(d => {
        const head = ['时间', '料号', '器件', '类型', '数量', '结存', '关联单号', '库位', '操作人', '备注'];
        Utils.exportSheet([head, ...d.list.map(t => [Utils.fmtDateTime(t.created_at), t.part_number, t.component_name,
          t.quantity > 0 ? '入库' : '出库', t.quantity, t.after_qty, t.ref_no || '', t.location || '',
          t.operator_name || '', t.remark || ''])], '出入库流水.xlsx', '流水');
      });
    }
  },
  mounted() {
    if (location.hash.includes('warning=1')) this.filters.only_warning = true;
    this.loadStock();
  },
  template: `
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>库存管理</h1>
        <p class="page-sub">实时库存、出入库流水与循环盘点</p>
      </div>
      <div class="page-actions">
        <el-button @click="exportStock"><el-icon><Files /></el-icon>导出库存</el-button>
        <el-button v-if="can('stock:check')" type="primary" @click="openCheckCreate"><el-icon><Finished /></el-icon>新建盘点</el-button>
      </div>
    </div>

    <el-tabs v-model="tab" @tab-change="switchTab" class="stock-tabs">
      <el-tab-pane label="库存查询" name="query">
        <div class="filter-bar">
          <el-input v-model="filters.keyword" placeholder="搜索料号 / 名称 / 型号 / 品牌" clearable @keyup.enter="searchStock" @clear="searchStock">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="filters.category_id" placeholder="全部分类" clearable @change="searchStock">
            <el-option v-for="c in Store.meta.categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-checkbox v-model="filters.only_warning" @change="searchStock">仅看预警</el-checkbox>
          <div class="spacer"></div>
          <el-button @click="resetStock">重置</el-button>
          <el-button type="primary" @click="searchStock">查询</el-button>
        </div>

        <div class="stat-strip">
          <div class="stat-item"><div class="l">库存 SKU</div><div class="v">{{ fmtQty(stats.sku) }}<small>项</small></div></div>
          <div class="stat-item"><div class="l">安全库存预警</div><div class="v danger">{{ stats.warning || 0 }}<small>项</small></div></div>
          <div class="stat-item"><div class="l">零库存</div><div class="v">{{ stats.zero || 0 }}<small>项</small></div></div>
          <div class="stat-item"><div class="l">库存总量</div><div class="v">{{ fmtQty(stats.total_qty) }}<small>件</small></div></div>
          <div class="stat-item"><div class="l">库存总值</div><div class="v">{{ fmtMoney(stats.total_value) }}</div></div>
          <div class="stat-item"><div class="l">在途金额</div><div class="v">{{ fmtMoney(stats.transit_value) }}</div></div>
        </div>

        <div class="table-card">
          <el-table :data="list" v-loading="loading" style="width:100%"
                    :row-class-name="({row}) => row.warning ? 'row-warning' : ''">
            <el-table-column label="料号" min-width="150" fixed>
              <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
            </el-table-column>
            <el-table-column label="器件" min-width="190">
              <template #default="{ row }">
                <div class="cell-main">{{ row.name }}</div>
                <div class="cell-sub">{{ row.brand }} · {{ row.model }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="category_name" label="分类" width="106" show-overflow-tooltip />
            <el-table-column label="现有库存" width="110" align="right">
              <template #default="{ row }">
                <span class="num" :class="{ danger: row.warning }" style="font-weight:600">{{ fmtQty(row.quantity) }}</span>
                <span class="muted-2" style="font-size:11px"> {{ row.unit }}</span>
              </template>
            </el-table-column>
            <el-table-column label="可用" width="80" align="right">
              <template #default="{ row }"><span class="num muted">{{ fmtQty(row.available) }}</span></template>
            </el-table-column>
            <el-table-column label="在途" width="80" align="right">
              <template #default="{ row }"><span class="num" :class="{ 'muted-2': !row.in_transit }">{{ fmtQty(row.in_transit) }}</span></template>
            </el-table-column>
            <el-table-column label="安全库存" width="88" align="right">
              <template #default="{ row }"><span class="num muted">{{ fmtQty(row.min_stock) }}</span></template>
            </el-table-column>
            <el-table-column label="库存金额" width="100" align="right">
              <template #default="{ row }"><span class="num">{{ fmtMoney(row.stock_value) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="100" align="center">
              <template #default="{ row }">
                <span class="pill" :class="row.warning ? 'red' : 'green'">{{ row.warning ? '需补货' : '正常' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right" align="center">
              <template #default="{ row }">
                <el-button v-if="can('stock:adjust')" link type="primary" @click="openAdjust(row)">调整</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <span class="info">共 {{ total }} 条记录</span>
            <el-pagination background layout="prev, pager, next, sizes" :total="total"
              v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[15, 30, 50, 100]"
              @current-change="loadStock" @size-change="searchStock" />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="出入库流水" name="tx">
        <div class="filter-bar">
          <el-input v-model="txFilters.keyword" placeholder="搜索料号 / 单号" clearable style="width:220px" @keyup.enter="loadTx" @clear="loadTx">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="txFilters.type" placeholder="全部类型" clearable style="width:130px" @change="loadTx">
            <el-option label="入库" value="in" />
            <el-option label="出库" value="out" />
            <el-option label="调整" value="adjust" />
          </el-select>
          <el-date-picker v-model="txFilters.range" type="daterange" value-format="YYYY-MM-DD"
            start-placeholder="开始日期" end-placeholder="结束日期" style="width:250px" @change="loadTx" />
          <div class="spacer"></div>
          <el-button @click="exportTx"><el-icon><Files /></el-icon>导出流水</el-button>
          <el-button type="primary" @click="loadTx">查询</el-button>
        </div>

        <div class="stat-strip">
          <div class="stat-item"><div class="l">流水笔数</div><div class="v">{{ fmtQty(txStats.cnt) }}</div></div>
          <div class="stat-item"><div class="l">入库数量</div><div class="v ok">+{{ fmtQty(txStats.in_qty) }}</div></div>
          <div class="stat-item"><div class="l">出库数量</div><div class="v danger">-{{ fmtQty(txStats.out_qty) }}</div></div>
        </div>

        <div class="table-card">
          <el-table :data="txList" v-loading="txLoading" style="width:100%">
            <el-table-column label="时间" width="140">
              <template #default="{ row }"><span class="muted num">{{ fmtDateTime(row.created_at) }}</span></template>
            </el-table-column>
            <el-table-column label="料号" min-width="140">
              <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
            </el-table-column>
            <el-table-column prop="component_name" label="器件" min-width="130" />
            <el-table-column label="类型" width="80">
              <template #default="{ row }">
                <span class="pill" :class="row.quantity > 0 ? 'green' : 'amber'">{{ row.quantity > 0 ? '入库' : '出库' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="数量" width="100" align="right">
              <template #default="{ row }">
                <span class="num" :class="row.quantity > 0 ? 'ok' : 'danger'" style="font-weight:600">
                  {{ row.quantity > 0 ? '+' : '' }}{{ fmtQty(row.quantity) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="结存" width="96" align="right">
              <template #default="{ row }"><span class="num muted">{{ fmtQty(row.after_qty) }}</span></template>
            </el-table-column>
            <el-table-column label="关联单号" min-width="150">
              <template #default="{ row }"><span class="mono">{{ row.ref_no || '—' }}</span></template>
            </el-table-column>
            <el-table-column prop="location" label="库位" width="94" />
            <el-table-column prop="operator_name" label="操作人" width="84" />
            <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
          </el-table>
          <div class="pager">
            <span class="info">共 {{ txTotal }} 条记录</span>
            <el-pagination background layout="prev, pager, next, sizes" :total="txTotal"
              v-model:current-page="txPage" v-model:page-size="txPageSize" :page-sizes="[15, 30, 50, 100]"
              @current-change="loadTx" @size-change="loadTx" />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="盘点管理" name="check">
        <div class="filter-bar">
          <span class="muted" style="font-size:12.5px">盘点完成后，差异将自动生成库存调整流水</span>
          <div class="spacer"></div>
          <el-button type="primary" @click="loadChecks"><el-icon><Refresh /></el-icon>刷新</el-button>
        </div>
        <div class="table-card">
          <el-table :data="checks" v-loading="checkLoading" style="width:100%">
            <el-table-column label="盘点单号" width="170">
              <template #default="{ row }"><span class="mono">{{ row.check_no }}</span></template>
            </el-table-column>
            <el-table-column prop="scope" label="盘点范围" min-width="150" />
            <el-table-column label="状态" width="112">
              <template #default="{ row }"><span class="pill" :class="pill(row.status).color">{{ pill(row.status).text }}</span></template>
            </el-table-column>
            <el-table-column prop="item_count" label="盘点项数" width="96" align="right" />
            <el-table-column label="差异项" width="90" align="right">
              <template #default="{ row }"><span class="num" :class="{ danger: row.diff_count }">{{ row.diff_count }}</span></template>
            </el-table-column>
            <el-table-column prop="operator_name" label="操作人" width="90" />
            <el-table-column label="创建时间" width="140">
              <template #default="{ row }"><span class="muted num">{{ fmtDateTime(row.created_at) }}</span></template>
            </el-table-column>
            <el-table-column label="完成时间" width="140">
              <template #default="{ row }"><span class="muted num">{{ row.finished_at ? fmtDateTime(row.finished_at) : '—' }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="90" align="center" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openCheck(row)">{{ row.status === 'done' ? '查看' : '盘点' }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <span class="info">共 {{ checkTotal }} 条记录</span>
            <el-pagination background layout="prev, pager, next" :total="checkTotal"
              v-model:current-page="checkPage" :page-size="checkPageSize" @current-change="loadChecks" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 库存调整 -->
    <el-dialog v-model="adjust.visible" title="库存调整" width="460px" append-to-body>
      <template v-if="adjust.row">
        <div class="file-chip" style="margin-bottom:16px">
          <el-icon><Box /></el-icon>
          <div>
            <div style="font-size:12.5px;font-weight:500">{{ adjust.row.name }}</div>
            <div class="mono muted-2" style="font-size:11px">{{ adjust.row.part_number }} · 现有 {{ fmtQty(adjust.row.quantity) }} {{ adjust.row.unit }}</div>
          </div>
        </div>
        <el-form label-position="top">
          <el-form-item label="调整数量（正数增加 / 负数减少）">
            <el-input-number v-model="adjust.quantity" :step="10" style="width:100%" />
          </el-form-item>
          <el-form-item label="调整原因">
            <el-input v-model="adjust.remark" type="textarea" :rows="2" placeholder="如：来料复检差异、盘盈盘亏" />
          </el-form-item>
        </el-form>
        <el-alert type="info" :closable="false" title="调整将写入库存流水（类型：adjust），可在流水中追溯。" />
      </template>
      <template #footer>
        <el-button @click="adjust.visible = false">取消</el-button>
        <el-button type="primary" :loading="adjust.saving" @click="saveAdjust">确认调整</el-button>
      </template>
    </el-dialog>

    <!-- 新建盘点 -->
    <el-dialog v-model="checkCreate.visible" title="新建盘点单" width="480px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="盘点范围" required>
          <el-input v-model="checkCreate.scope" placeholder="如：A区阻容件 / 季度全盘" />
        </el-form-item>
        <el-form-item label="限定分类（可选）">
          <el-select v-model="checkCreate.category_id" clearable placeholder="不选则盘点全部器件" style="width:100%">
            <el-option v-for="c in Store.meta.categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="checkCreate.remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="checkCreate.visible = false">取消</el-button>
        <el-button type="primary" :loading="checkCreate.saving" @click="createCheck">创建并开始盘点</el-button>
      </template>
    </el-dialog>

    <!-- 盘点详情 -->
    <el-drawer v-model="checkDetail.visible" size="820px" title="盘点明细" destroy-on-close>
      <div v-loading="checkDetail.loading">
        <template v-if="checkDetail.data">
          <div style="padding:18px 22px">
            <div class="flex-between" style="margin-bottom:14px">
              <div>
                <div class="mono muted" style="font-size:12px">{{ checkDetail.data.check.check_no }}</div>
                <div style="font-size:17px;font-weight:600;margin-top:4px">{{ checkDetail.data.check.scope }}</div>
                <div class="muted-2" style="font-size:11.5px;margin-top:4px">
                  {{ checkDetail.data.check.operator_name }} 创建于 {{ fmtDateTime(checkDetail.data.check.created_at) }}
                </div>
              </div>
              <span class="pill" :class="pill(checkDetail.data.check.status).color">{{ pill(checkDetail.data.check.status).text }}</span>
            </div>
            <el-alert v-if="checkDetail.data.check.status !== 'done'" type="info" :closable="false"
              title="请录入实盘数量，系统自动计算差异；完成盘点后将按差异调整库存并生成流水。" style="margin-bottom:12px" />
            <el-table :data="checkDetail.data.items" size="small" style="width:100%" max-height="480">
              <el-table-column label="料号" min-width="140">
                <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
              </el-table-column>
              <el-table-column prop="name" label="器件" min-width="120" />
              <el-table-column prop="package" label="封装" width="82" />
              <el-table-column label="账面数量" width="100" align="right">
                <template #default="{ row }"><span class="num muted">{{ fmtQty(row.book_qty) }}</span></template>
              </el-table-column>
              <el-table-column label="实盘数量" width="140" align="right">
                <template #default="{ row }">
                  <el-input-number v-if="checkDetail.data.check.status !== 'done'" v-model="row.actual_qty"
                    :min="0" :controls="false" size="small" style="width:110px" />
                  <span v-else class="num">{{ fmtQty(row.actual_qty) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="差异" width="100" align="right">
                <template #default="{ row }">
                  <span class="num" :class="diffOf(row) > 0 ? 'ok' : (diffOf(row) < 0 ? 'danger' : 'muted-2')">
                    {{ diffOf(row) > 0 ? '+' : '' }}{{ fmtQty(diffOf(row)) }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </div>
      <template #footer>
        <div class="flex-between">
          <span class="muted-2" style="font-size:11.5px">共 {{ checkDetail.data?.items.length || 0 }} 项</span>
          <div>
            <el-button @click="checkDetail.visible = false">关闭</el-button>
            <template v-if="checkDetail.data && checkDetail.data.check.status !== 'done'">
              <el-button :loading="checkDetail.saving" @click="saveCheckItems">保存盘点数据</el-button>
              <el-button type="primary" @click="finishCheck">完成盘点</el-button>
            </template>
          </div>
        </div>
      </template>
    </el-drawer>
  </div>
  `
};
