window.Pages = window.Pages || {};

window.Pages['page-dashboard'] = {
  name: 'page-dashboard',
  data() {
    return {
      loading: true,
      kpi: {},
      trend: [],
      category: [],
      warnings: [],
      shortageTop: [],
      recentTx: [],
      lifecycle: [],
      recentAnalyses: [],
      todo: {},
      trendChart: null,
      catChart: null,
      shortageChart: null
    };
  },
  computed: {
    warnPct() {
      if (!this.kpi.components) return 0;
      return Math.round((this.kpi.warning / this.kpi.components) * 100);
    },
    trendEmpty() {
      return !(this.trend || []).some(x => Number(x.in_qty) || Number(x.out_qty));
    },
    catTop() {
      const list = [...(this.category || [])];
      if (list.length <= 7) return list;
      const head = list.slice(0, 7);
      const rest = list.slice(7).reduce((a, c) => a + Number(c.value || 0), 0);
      head.push({ name: '其他', value: rest });
      return head;
    }
  },
  methods: {
    fmtQty: Utils.fmtQty,
    fmtMoney: Utils.fmtMoney,
    fmtMoneyCompact: Utils.fmtMoneyCompact,
    fmtCompact: Utils.fmtCompact,
    pill: Utils.pill,
    fmtDateTime: Utils.fmtDateTime,
    fromNow: Utils.fromNow,
    go(p) { location.hash = '#' + p; },
    async load() {
      this.loading = true;
      try {
        const d = await Api.get('/reports/dashboard');
        Object.assign(this, d);
        this.$nextTick(() => this.renderCharts());
      } finally {
        this.loading = false;
      }
    },
    renderCharts() {
      const t = Utils.chartTheme;
      if (this.trendChart) Utils.disposeChart(this.trendChart);
      if (this.catChart) Utils.disposeChart(this.catChart);

      this.trendChart = Utils.mountChart(this.$refs.trend, {
        color: ['#2563eb', '#0ea5a4'],
        tooltip: {
          ...Utils.baseTooltip(),
          valueFormatter: v => Utils.fmtQty(v)
        },
        legend: {
          right: 4, top: 0, icon: 'roundRect', itemWidth: 8, itemHeight: 8, itemGap: 18,
          textStyle: { color: t.text, fontSize: 11.5 }
        },
        grid: { left: 4, right: 8, top: 38, bottom: 4, containLabel: true },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: this.trend.map(x => x.date.slice(5)),
          axisLine: { lineStyle: { color: t.axis } },
          axisTick: { show: false },
          axisLabel: { color: '#94a3b8', fontSize: 10.5, interval: 4 }
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
          axisLabel: { color: '#94a3b8', fontSize: 10.5, formatter: v => Utils.fmtCompact(v) }
        },
        series: [
          {
            name: '入库', type: 'line', smooth: 0.35, symbol: 'none',
            lineStyle: { width: 2 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(37,99,235,.16)' },
                { offset: 1, color: 'rgba(37,99,235,0)' }
              ])
            },
            data: this.trend.map(x => x.in_qty)
          },
          {
            name: '出库', type: 'line', smooth: 0.35, symbol: 'none',
            lineStyle: { width: 2 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(14,165,164,.14)' },
                { offset: 1, color: 'rgba(14,165,164,0)' }
              ])
            },
            data: this.trend.map(x => x.out_qty)
          }
        ]
      });

      this.catChart = Utils.mountChart(this.$refs.cat, {
        color: ['#2563eb', '#0ea5a4', '#6366f1', '#f59e0b', '#0f766e', '#94a3b8', '#bfdbfe', '#e2e8f0'],
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(15,23,42,.94)', borderWidth: 0,
          textStyle: { color: '#fff', fontSize: 11.5 },
          formatter: p => `${p.name}<br/>${Utils.fmtMoney(p.value)} · ${p.percent}%`
        },
        legend: {
          orient: 'vertical', right: 0, top: 'middle', icon: 'circle',
          itemWidth: 7, itemHeight: 7, itemGap: 12,
          textStyle: { color: t.text, fontSize: 11.5 },
          formatter: name => {
            const item = this.catTop.find(c => c.name === name);
            return `${name}  ${item ? Utils.fmtMoneyCompact(item.value) : ''}`;
          }
        },
        series: [{
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['32%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          data: this.catTop.map(c => ({ name: c.name, value: Number(c.value || 0) }))
        }]
      });
    }
  },
  mounted() { this.load(); },
  beforeUnmount() {
    Utils.disposeChart(this.trendChart);
    Utils.disposeChart(this.catChart);
  },
  template: `
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>工作台</h1>
        <p class="page-sub">库存健康度、缺料风险与业务待办总览</p>
      </div>
      <div class="page-actions">
        <el-button @click="go('/bom')"><el-icon><Grid /></el-icon>BOM 缺料分析</el-button>
        <el-button type="primary" @click="go('/orders/inbound')"><el-icon><Download /></el-icon>入库登记</el-button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-label">器件 SKU</div>
          <div class="kpi-icon"><el-icon><Box /></el-icon></div>
        </div>
        <div class="kpi-value">{{ fmtQty(kpi.components) }}<small>项</small></div>
        <div class="kpi-foot">零库存 <b class="up">{{ kpi.zero_stock || 0 }}</b> 项 · 预警 <b>{{ kpi.warning || 0 }}</b> 项</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-label">库存总量</div>
          <div class="kpi-icon"><el-icon><Coin /></el-icon></div>
        </div>
        <div class="kpi-value">{{ fmtCompact(kpi.total_qty) }}<small>件</small></div>
        <div class="kpi-foot">在途 <b>{{ fmtQty(kpi.in_transit_qty) }}</b> 件</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-label">库存总值</div>
          <div class="kpi-icon"><el-icon><Wallet /></el-icon></div>
        </div>
        <div class="kpi-value">{{ fmtMoneyCompact(kpi.total_value) }}</div>
        <div class="kpi-foot">在途金额 <b>{{ fmtMoneyCompact(kpi.transit_value) }}</b></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-label">安全库存预警</div>
          <div class="kpi-icon danger"><el-icon><Warning /></el-icon></div>
        </div>
        <div class="kpi-value" :class="{ danger: kpi.warning > 0 }">{{ kpi.warning || 0 }}<small>项</small></div>
        <div class="kpi-foot">占 SKU 总数 <b class="up">{{ warnPct }}%</b></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-label">本月出库</div>
          <div class="kpi-icon ok"><el-icon><Sort /></el-icon></div>
        </div>
        <div class="kpi-value">{{ fmtCompact(kpi.month_out) }}<small>件</small></div>
        <div class="kpi-foot">待办单据 <b>{{ (todo.pending_inbound||0)+(todo.pending_outbound||0)+(todo.pending_request||0) }}</b> 项</div>
      </div>
    </div>

    <div class="grid-2-1">
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title"><span class="bar"></span>出入库趋势</div>
            <div class="panel-sub">近 30 天库存流水</div>
          </div>
          <span class="muted-2" style="font-size:11.5px">单位：件</span>
        </div>
        <div class="panel-body">
          <div class="chart-wrap">
            <div ref="trend" class="chart-box"></div>
            <div v-if="trendEmpty" class="chart-empty">暂无出入库数据</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title"><span class="bar"></span>库存金额结构</div>
            <div class="panel-sub">按器件分类</div>
          </div>
        </div>
        <div class="panel-body">
          <div class="chart-wrap">
            <div ref="cat" class="chart-box"></div>
            <div v-if="!catTop.length" class="chart-empty">暂无库存数据</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-2-1" style="margin-top:16px">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><span class="bar"></span>安全库存预警</div>
          <el-button text type="primary" @click="go('/stock?warning=1')">查看全部<el-icon><ArrowRight /></el-icon></el-button>
        </div>
        <el-table :data="warnings" style="width:100%" size="default" :show-header="true">
          <el-table-column label="料号" min-width="150">
            <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
          </el-table-column>
          <el-table-column label="器件" min-width="150">
            <template #default="{ row }">
              <div class="cell-main">{{ row.name }}</div>
              <div class="cell-sub">{{ row.brand }} · {{ row.model }}</div>
            </template>
          </el-table-column>
          <el-table-column label="现有 / 安全" width="120" align="right">
            <template #default="{ row }">
              <span class="num danger" style="font-weight:600">{{ fmtQty(row.quantity) }}</span>
              <span class="muted-2"> / {{ fmtQty(row.min_stock) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="缺口" width="100" align="right">
            <template #default="{ row }"><span class="num danger">{{ fmtQty(row.gap) }}</span></template>
          </el-table-column>
          <el-table-column label="缺口率" width="130">
            <template #default="{ row }">
              <div class="flex gap-8">
                <div class="bar-mini" style="flex:1"><i :style="{ width: Math.min(100, row.gap_pct||0) + '%' }"></i></div>
                <span class="num muted" style="font-size:11px">{{ row.gap_pct || 0 }}%</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><span class="bar"></span>待办事项</div>
        </div>
        <div class="panel-body" style="padding:8px 18px 4px">
          <div class="todo-item" @click="go('/orders/inbound')">
            <div class="ti-ic"><el-icon><Download /></el-icon></div>
            <div class="ti-t">入库待确认</div>
            <div class="ti-n num">{{ todo.pending_inbound || 0 }}</div>
          </div>
          <div class="todo-item" @click="go('/orders/outbound')">
            <div class="ti-ic"><el-icon><Upload /></el-icon></div>
            <div class="ti-t">出库待确认</div>
            <div class="ti-n num">{{ todo.pending_outbound || 0 }}</div>
          </div>
          <div class="todo-item" @click="go('/purchase/requests')">
            <div class="ti-ic"><el-icon><DocumentChecked /></el-icon></div>
            <div class="ti-t">采购待审批</div>
            <div class="ti-n num">{{ todo.pending_request || 0 }}</div>
          </div>
          <div class="todo-item" @click="go('/purchase/orders')">
            <div class="ti-ic"><el-icon><Van /></el-icon></div>
            <div class="ti-t">在途采购订单</div>
            <div class="ti-n num">{{ todo.open_orders || 0 }}</div>
          </div>
        </div>
        <div class="panel-head" style="border-top:1px solid var(--line-soft);border-bottom:none;padding-top:14px">
          <div class="panel-title" style="font-size:12.5px"><span class="bar"></span>最近动态</div>
        </div>
        <div class="panel-body" style="padding:0 18px 16px">
          <div v-for="tx in recentTx.slice(0,7)" :key="tx.id" class="feed-item">
            <span class="feed-dot" :class="tx.quantity > 0 ? 'in' : 'out'"></span>
            <div style="flex:1;min-width:0">
              <div class="feed-t">
                <span class="mono" style="font-size:11.5px">{{ tx.part_number }}</span>
                <span class="feed-q" :class="tx.quantity > 0 ? 'ok' : 'danger'">
                  {{ tx.quantity > 0 ? '+' : '' }}{{ fmtQty(tx.quantity) }}
                </span>
              </div>
              <div class="feed-s">{{ tx.operator_name || '系统' }} · {{ fromNow(tx.created_at) }}</div>
            </div>
          </div>
          <div v-if="!recentTx.length" class="empty-box" style="padding:20px">
            <div class="s">暂无动态</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `
};
