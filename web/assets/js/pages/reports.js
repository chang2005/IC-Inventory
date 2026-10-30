window.Pages = window.Pages || {};

window.Pages['page-reports'] = {
  name: 'page-reports',
  data() {
    return {
      tab: 'stock',
      loading: false,
      summary: null,
      consumption: null,
      purchase: null,
      days: 90,
      charts: {}
    };
  },
  computed: {
    stockEmpty() { return !this.summary || !(this.summary.byCategory || []).length; },
    consumeEmpty() { return !this.consumption || !(this.consumption.trend || []).some(x => Number(x.qty)); },
    purchaseEmpty() { return !this.purchase || !(this.purchase.bySupplier || []).some(x => Number(x.amount)); }
  },
  methods: {
    fmtQty: Utils.fmtQty,
    fmtMoney: Utils.fmtMoney,
    fmtMoneyCompact: Utils.fmtMoneyCompact,
    fmtDate: Utils.fmtDate,
    pill: Utils.pill,
    async loadSummary() {
      this.loading = true;
      try {
        this.summary = await Api.get('/reports/stock-summary');
        this.$nextTick(() => this.renderSummary());
      } finally { this.loading = false; }
    },
    async loadConsumption() {
      this.loading = true;
      try {
        this.consumption = await Api.get('/reports/consumption', { days: this.days });
        this.$nextTick(() => this.renderConsumption());
      } finally { this.loading = false; }
    },
    async loadPurchase() {
      this.loading = true;
      try {
        this.purchase = await Api.get('/reports/supplier-purchase');
        this.$nextTick(() => this.renderPurchase());
      } finally { this.loading = false; }
    },
    switchTab(name) {
      if (name === 'stock') this.loadSummary();
      if (name === 'consume') this.loadConsumption();
      if (name === 'purchase') this.loadPurchase();
    },
    dispose(name) {
      if (this.charts[name]) { Utils.disposeChart(this.charts[name]); delete this.charts[name]; }
    },
    renderSummary() {
      const t = Utils.chartTheme;
      this.dispose('cat');
      this.dispose('brand');
      if (this.$refs.catChart) {
        const rows = [...(this.summary?.byCategory || [])].slice(0, 10).reverse();
        this.charts.cat = Utils.mountChart(this.$refs.catChart, {
          tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' },
            backgroundColor: 'rgba(15,23,42,.94)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 11.5 },
            formatter: p => `${p[0].name}<br/>库存金额 ${Utils.fmtMoney(p[0].value)}`
          },
          grid: { left: 4, right: 60, top: 8, bottom: 4, containLabel: true },
          xAxis: {
            type: 'value', splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
            axisLabel: { color: '#94a3b8', fontSize: 10.5, formatter: v => Utils.fmtMoneyCompact(v) }
          },
          yAxis: {
            type: 'category', data: rows.map(r => r.name),
            axisLine: { show: false }, axisTick: { show: false },
            axisLabel: { color: t.text, fontSize: 11 }
          },
          series: [{
            type: 'bar', data: rows.map(r => Number(r.value || 0)), barWidth: 11,
            itemStyle: {
              borderRadius: [0, 3, 3, 0],
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: '#2563eb' }, { offset: 1, color: '#60a5fa' }
              ])
            },
            label: {
              show: true, position: 'right', color: '#94a3b8', fontSize: 10,
              formatter: p => Utils.fmtMoneyCompact(p.value)
            }
          }]
        });
      }
      if (this.$refs.brandChart) {
        const rows = [...(this.summary?.byBrand || [])].slice(0, 10);
        this.charts.brand = Utils.mountChart(this.$refs.brandChart, {
          tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' },
            backgroundColor: 'rgba(15,23,42,.94)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 11.5 },
            formatter: p => `${p[0].name}<br/>库存金额 ${Utils.fmtMoney(p[0].value)}`
          },
          grid: { left: 4, right: 8, top: 18, bottom: 4, containLabel: true },
          xAxis: {
            type: 'category', data: rows.map(r => r.name),
            axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
            axisLabel: { color: '#94a3b8', fontSize: 10, interval: 0, rotate: 30 }
          },
          yAxis: {
            type: 'value', splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
            axisLabel: { color: '#94a3b8', fontSize: 10.5, formatter: v => Utils.fmtMoneyCompact(v) }
          },
          series: [{
            type: 'bar', data: rows.map(r => Number(r.value || 0)), barWidth: '46%',
            itemStyle: { borderRadius: [3, 3, 0, 0], color: '#0ea5a4' }
          }]
        });
      }
    },
    renderConsumption() {
      const t = Utils.chartTheme;
      this.dispose('consume');
      if (!this.$refs.consumeChart || !this.consumption) return;
      const data = this.consumption.trend;
      this.charts.consume = Utils.mountChart(this.$refs.consumeChart, {
        tooltip: { ...Utils.baseTooltip(), valueFormatter: v => Utils.fmtQty(v) },
        grid: { left: 4, right: 10, top: 20, bottom: 4, containLabel: true },
        xAxis: {
          type: 'category', boundaryGap: false, data: data.map(d => d.date.slice(5)),
          axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
          axisLabel: { color: '#94a3b8', fontSize: 10.5, interval: Math.floor(data.length / 10) }
        },
        yAxis: {
          type: 'value', splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
          axisLabel: { color: '#94a3b8', fontSize: 10.5, formatter: v => Utils.fmtCompact(v) }
        },
        series: [{
          name: '出库量', type: 'line', smooth: 0.35, symbol: 'none', lineStyle: { width: 2, color: '#2563eb' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(37,99,235,.18)' }, { offset: 1, color: 'rgba(37,99,235,0)' }
            ])
          },
          data: data.map(d => d.qty)
        }]
      });
    },
    renderPurchase() {
      const t = Utils.chartTheme;
      this.dispose('supplier');
      this.dispose('month');
      if (this.$refs.supplierChart && this.purchase) {
        const rows = [...this.purchase.bySupplier].slice(0, 8).reverse();
        this.charts.supplier = Utils.mountChart(this.$refs.supplierChart, {
          tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' },
            backgroundColor: 'rgba(15,23,42,.94)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 11.5 },
            formatter: p => `${p[0].name}<br/>采购金额 ${Utils.fmtMoney(p[0].value)}`
          },
          grid: { left: 4, right: 64, top: 8, bottom: 4, containLabel: true },
          xAxis: {
            type: 'value', splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
            axisLabel: { color: '#94a3b8', fontSize: 10.5, formatter: v => Utils.fmtMoneyCompact(v) }
          },
          yAxis: {
            type: 'category', data: rows.map(r => r.name),
            axisLine: { show: false }, axisTick: { show: false },
            axisLabel: { color: t.text, fontSize: 10.5, width: 150, overflow: 'truncate' }
          },
          series: [{
            type: 'bar', data: rows.map(r => Number(r.amount || 0)), barWidth: 10,
            itemStyle: {
              borderRadius: [0, 3, 3, 0],
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: '#2563eb' }, { offset: 1, color: '#93c5fd' }
              ])
            },
            label: { show: true, position: 'right', color: '#94a3b8', fontSize: 10, formatter: p => Utils.fmtMoneyCompact(p.value) }
          }]
        });
      }
      if (this.$refs.monthChart && this.purchase) {
        const rows = this.purchase.monthly;
        this.charts.month = Utils.mountChart(this.$refs.monthChart, {
          tooltip: {
            ...Utils.baseTooltip(),
            formatter: p => `${p[0].axisValue}<br/>采购金额 ${Utils.fmtMoney(p[0].value)}<br/>订单数 ${p[1] ? p[1].value : 0}`
          },
          grid: { left: 4, right: 10, top: 30, bottom: 4, containLabel: true },
          legend: { right: 0, top: 0, icon: 'roundRect', itemWidth: 8, itemHeight: 8, textStyle: { color: t.text, fontSize: 11 } },
          xAxis: {
            type: 'category', data: rows.map(r => r.month), axisLine: { lineStyle: { color: t.axis } },
            axisTick: { show: false }, axisLabel: { color: '#94a3b8', fontSize: 10.5 }
          },
          yAxis: [
            {
              type: 'value', splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
              axisLabel: { color: '#94a3b8', fontSize: 10.5, formatter: v => Utils.fmtMoneyCompact(v) }
            },
            { type: 'value', splitLine: { show: false }, axisLabel: { color: '#94a3b8', fontSize: 10.5 } }
          ],
          series: [
            { name: '采购金额', type: 'bar', barWidth: '42%', itemStyle: { borderRadius: [3, 3, 0, 0], color: '#2563eb' }, data: rows.map(r => Number(r.amount || 0)) },
            { name: '订单数', type: 'line', yAxisIndex: 1, smooth: true, symbolSize: 5, lineStyle: { width: 2, color: '#0ea5a4' }, itemStyle: { color: '#0ea5a4' }, data: rows.map(r => Number(r.orders || 0)) }
          ]
        });
      }
    }
  },
  mounted() { this.loadSummary(); },
  beforeUnmount() {
    Object.keys(this.charts).forEach(k => this.dispose(k));
  },
  template: `
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>报表中心</h1>
        <p class="page-sub">库存结构、消耗趋势与供应商采购分析</p>
      </div>
      <div class="page-actions">
        <el-button @click="switchTab(tab)"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>
    </div>

    <el-tabs v-model="tab" @tab-change="switchTab">
      <el-tab-pane label="库存汇总" name="stock">
        <div v-loading="loading">
          <div v-if="summary" class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
            <div class="kpi-card">
              <div class="kpi-top"><div class="kpi-label">库存 SKU</div><div class="kpi-icon"><el-icon><Box /></el-icon></div></div>
              <div class="kpi-value">{{ summary.total.sku }}<small>项</small></div>
              <div class="kpi-foot">覆盖 {{ summary.byCategory.length }} 个分类</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-top"><div class="kpi-label">库存总量</div><div class="kpi-icon"><el-icon><Coin /></el-icon></div></div>
              <div class="kpi-value">{{ fmtQty(summary.total.qty) }}<small>件</small></div>
              <div class="kpi-foot">在途金额 {{ fmtMoneyCompact(summary.total.transit_value) }}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-top"><div class="kpi-label">库存总值</div><div class="kpi-icon ok"><el-icon><Wallet /></el-icon></div></div>
              <div class="kpi-value">{{ fmtMoneyCompact(summary.total.value) }}</div>
              <div class="kpi-foot">移动加权平均计价</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-top"><div class="kpi-label">停产 / 不推荐器件</div><div class="kpi-icon warn"><el-icon><Warning /></el-icon></div></div>
              <div class="kpi-value">{{ (summary.lifecycle.find(l=>l.lifecycle==='eol')?.sku || 0) + (summary.lifecycle.find(l=>l.lifecycle==='nrnd')?.sku || 0) }}<small>项</small></div>
              <div class="kpi-foot">需关注替代与最后一次采购</div>
            </div>
          </div>

          <div class="grid-1-1" style="margin-top:16px">
            <div class="panel">
              <div class="panel-head"><div class="panel-title"><span class="bar"></span>分类库存金额</div></div>
              <div class="panel-body">
                <div class="chart-wrap">
                  <div ref="catChart" class="chart-box lg"></div>
                  <div v-if="stockEmpty" class="chart-empty">暂无库存数据</div>
                </div>
              </div>
            </div>
            <div class="panel">
              <div class="panel-head"><div class="panel-title"><span class="bar"></span>品牌库存金额 TOP10</div></div>
              <div class="panel-body">
                <div class="chart-wrap">
                  <div ref="brandChart" class="chart-box lg"></div>
                  <div v-if="stockEmpty" class="chart-empty">暂无库存数据</div>
                </div>
              </div>
            </div>
          </div>

          <div class="panel" style="margin-top:16px">
            <div class="panel-head">
              <div class="panel-title"><span class="bar"></span>库存金额 TOP10 器件</div>
            </div>
            <el-table :data="summary?.topValue || []" style="width:100%">
              <el-table-column label="料号" min-width="160">
                <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
              </el-table-column>
              <el-table-column label="器件 / 型号" min-width="220">
                <template #default="{ row }">
                  <div class="cell-main">{{ row.name }}</div>
                  <div class="cell-sub">{{ row.brand }} · {{ row.model }}</div>
                </template>
              </el-table-column>
              <el-table-column label="库存数量" width="120" align="right">
                <template #default="{ row }"><span class="num">{{ fmtQty(row.quantity) }} <span class="muted-2" style="font-size:11px">{{ row.unit }}</span></span></template>
              </el-table-column>
              <el-table-column label="均价" width="110" align="right">
                <template #default="{ row }"><span class="num">{{ fmtMoney(row.avg_price, 4) }}</span></template>
              </el-table-column>
              <el-table-column label="库存金额" width="130" align="right">
                <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtMoney(row.value) }}</span></template>
              </el-table-column>
              <el-table-column label="占比" min-width="160">
                <template #default="{ row }">
                  <div class="flex gap-8">
                    <div class="bar-mini warn" style="flex:1"><i :style="{ width: Math.min(100, row.value / (summary.total.value||1) * 100) + '%' }"></i></div>
                    <span class="num muted" style="font-size:11px">{{ (row.value / (summary.total.value||1) * 100).toFixed(1) }}%</span>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="消耗分析" name="consume">
        <div v-loading="loading">
          <div class="filter-bar">
            <span class="muted" style="font-size:12.5px">统计区间</span>
            <el-radio-group v-model="days" @change="loadConsumption">
              <el-radio-button :value="30">近 30 天</el-radio-button>
              <el-radio-button :value="60">近 60 天</el-radio-button>
              <el-radio-button :value="90">近 90 天</el-radio-button>
              <el-radio-button :value="180">近 180 天</el-radio-button>
            </el-radio-group>
            <div class="spacer"></div>
            <span class="muted-2" style="font-size:11.5px">呆滞料：区间内无出库记录的库存</span>
          </div>

          <div class="panel">
            <div class="panel-head">
              <div class="panel-title"><span class="bar"></span>出库消耗趋势</div>
              <span class="muted-2" style="font-size:11.5px">单位：件</span>
            </div>
            <div class="panel-body">
              <div class="chart-wrap">
                <div ref="consumeChart" class="chart-box"></div>
                <div v-if="consumeEmpty" class="chart-empty">该区间暂无出库记录</div>
              </div>
            </div>
          </div>

          <div class="grid-1-1" style="margin-top:16px">
            <div class="panel">
              <div class="panel-head"><div class="panel-title"><span class="bar"></span>消耗量 TOP12</div></div>
              <el-table :data="consumption?.topConsumed || []" size="small" style="width:100%" max-height="380">
                <el-table-column label="料号" min-width="140">
                  <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
                </el-table-column>
                <el-table-column prop="name" label="器件" min-width="110" />
                <el-table-column label="消耗量" width="96" align="right">
                  <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtQty(row.qty) }}</span></template>
                </el-table-column>
                <el-table-column label="次数" width="66" align="right">
                  <template #default="{ row }"><span class="num muted">{{ row.times }}</span></template>
                </el-table-column>
                <el-table-column label="金额" width="104" align="right">
                  <template #default="{ row }"><span class="num">{{ fmtMoney(row.amount) }}</span></template>
                </el-table-column>
              </el-table>
            </div>
            <div class="panel">
              <div class="panel-head">
                <div class="panel-title"><span class="bar"></span>呆滞料清单</div>
                <span class="muted-2" style="font-size:11.5px">按库存金额排序</span>
              </div>
              <el-table :data="consumption?.slowMoving || []" size="small" style="width:100%" max-height="380">
                <el-table-column label="料号" min-width="140">
                  <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
                </el-table-column>
                <el-table-column prop="name" label="器件" min-width="110" />
                <el-table-column label="库存" width="86" align="right">
                  <template #default="{ row }"><span class="num">{{ fmtQty(row.quantity) }}</span></template>
                </el-table-column>
                <el-table-column label="金额" width="104" align="right">
                  <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtMoney(row.value) }}</span></template>
                </el-table-column>
                <el-table-column label="最近出库" width="104">
                  <template #default="{ row }">
                    <span class="muted-2" style="font-size:11px">{{ row.last_out_at ? fmtDate(row.last_out_at) : '从未出库' }}</span>
                  </template>
                </el-table-column>
              </el-table>
              <div v-if="consumption && !consumption.slowMoving.length" class="empty-box">
                <div class="s">该区间内没有呆滞料</div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="采购分析" name="purchase">
        <div v-loading="loading">
          <div class="grid-1-1">
            <div class="panel">
              <div class="panel-head"><div class="panel-title"><span class="bar"></span>供应商采购额</div></div>
              <div class="panel-body">
                <div class="chart-wrap">
                  <div ref="supplierChart" class="chart-box lg"></div>
                  <div v-if="purchaseEmpty" class="chart-empty">暂无采购数据</div>
                </div>
              </div>
            </div>
            <div class="panel">
              <div class="panel-head"><div class="panel-title"><span class="bar"></span>月度采购趋势</div></div>
              <div class="panel-body">
                <div class="chart-wrap">
                  <div ref="monthChart" class="chart-box lg"></div>
                  <div v-if="purchaseEmpty" class="chart-empty">暂无采购数据</div>
                </div>
              </div>
            </div>
          </div>

          <div class="grid-1-1" style="margin-top:16px">
            <div class="panel">
              <div class="panel-head"><div class="panel-title"><span class="bar"></span>供应商采购明细</div></div>
              <el-table :data="purchase?.bySupplier || []" size="small" style="width:100%" max-height="400">
                <el-table-column prop="name" label="供应商" min-width="200" show-overflow-tooltip />
                <el-table-column label="评级" width="120">
                  <template #default="{ row }">
                    <el-rate :model-value="row.rating" disabled size="small" />
                  </template>
                </el-table-column>
                <el-table-column label="订单数" width="76" align="right">
                  <template #default="{ row }"><span class="num muted">{{ row.order_count }}</span></template>
                </el-table-column>
                <el-table-column label="采购金额" width="126" align="right">
                  <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtMoney(row.amount) }}</span></template>
                </el-table-column>
              </el-table>
            </div>
            <div class="panel">
              <div class="panel-head"><div class="panel-title"><span class="bar"></span>采购金额 TOP10 器件</div></div>
              <el-table :data="purchase?.topComponents || []" size="small" style="width:100%" max-height="400">
                <el-table-column label="料号" min-width="140">
                  <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
                </el-table-column>
                <el-table-column prop="name" label="器件" min-width="110" />
                <el-table-column label="采购量" width="96" align="right">
                  <template #default="{ row }"><span class="num">{{ fmtQty(row.qty) }}</span></template>
                </el-table-column>
                <el-table-column label="金额" width="118" align="right">
                  <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtMoney(row.amount) }}</span></template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
  `
};
