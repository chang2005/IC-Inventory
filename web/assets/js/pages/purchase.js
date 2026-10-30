window.Pages = window.Pages || {};

window.Pages['page-purchase'] = {
  name: 'page-purchase',
  props: ['params', 'route'],
  data() {
    return {
      tab: 'requests',
      reqLoading: false,
      requests: [],
      reqTotal: 0,
      reqPage: 1,
      reqPageSize: 15,
      reqFilters: { keyword: '', status: '' },
      ordLoading: false,
      orders: [],
      ordTotal: 0,
      ordPage: 1,
      ordPageSize: 15,
      ordFilters: { keyword: '', status: '' },
      detail: { visible: false, loading: false, type: 'request', data: null },
      approve: { visible: false, row: null, approve: true, remark: '', saving: false },
      create: { visible: false, saving: false, title: '', remark: '', items: [] },
      orderDetail: { visible: false, loading: false, data: null }
    };
  },
  methods: {
    fmtQty: Utils.fmtQty,
    fmtMoney: Utils.fmtMoney,
    fmtDateTime: Utils.fmtDateTime,
    fmtDate: Utils.fmtDate,
    pill: Utils.pill,
    async loadRequests() {
      this.reqLoading = true;
      try {
        const d = await Api.get('/purchase/requests', {
          page: this.reqPage, pageSize: this.reqPageSize,
          keyword: this.reqFilters.keyword, status: this.reqFilters.status
        });
        this.requests = d.list;
        this.reqTotal = d.total;
      } finally { this.reqLoading = false; }
    },
    async loadOrders() {
      this.ordLoading = true;
      try {
        const d = await Api.get('/purchase/orders', {
          page: this.ordPage, pageSize: this.ordPageSize,
          keyword: this.ordFilters.keyword, status: this.ordFilters.status
        });
        this.orders = d.list;
        this.ordTotal = d.total;
      } finally { this.ordLoading = false; }
    },
    switchTab(name) {
      if (name === 'requests') this.loadRequests();
      else this.loadOrders();
    },
    async openRequest(row) {
      this.detail.visible = true;
      this.detail.type = 'request';
      this.detail.loading = true;
      this.detail.data = null;
      try { this.detail.data = await Api.get('/purchase/requests/' + row.id); }
      finally { this.detail.loading = false; }
    },
    async openOrder(row) {
      this.detail.visible = true;
      this.detail.type = 'order';
      this.detail.loading = true;
      this.detail.data = null;
      try { this.detail.data = await Api.get('/purchase/orders/' + row.id); }
      finally { this.detail.loading = false; }
    },
    async submitRequest(row) {
      try {
        await Api.post(`/purchase/requests/${row.id}/submit`);
        Api.toast('已提交审批', 'success');
        this.loadRequests();
      } catch (e) { /* handled */ }
    },
    openApprove(row) {
      this.approve = { visible: true, row, approve: true, remark: '', saving: false };
    },
    async doApprove() {
      this.approve.saving = true;
      try {
        await Api.post(`/purchase/requests/${this.approve.row.id}/approve`, {
          approve: this.approve.approve, remark: this.approve.remark
        });
        Api.toast(this.approve.approve ? '审批已通过' : '已驳回', 'success');
        this.approve.visible = false;
        this.loadRequests();
      } catch (e) { /* handled */ } finally { this.approve.saving = false; }
    },
    async toOrders(row) {
      try {
        await this.$confirm('系统将按器件主供应商拆分生成采购订单（草稿），确认继续？', '生成采购订单', {
          type: 'info', confirmButtonText: '确认生成', cancelButtonText: '取消'
        });
      } catch (e) { return; }
      try {
        const d = await Api.post(`/purchase/requests/${row.id}/to-orders`);
        Api.toast(`已生成 ${d.orders.length} 张采购订单`, 'success');
        this.loadRequests();
        this.tab = 'orders';
        this.loadOrders();
      } catch (e) { /* handled */ }
    },
    async deleteRequest(row) {
      try {
        await this.$confirm(`确认删除采购申请 ${row.request_no}？`, '删除申请', { type: 'warning' });
      } catch (e) { return; }
      try {
        await Api.del('/purchase/requests/' + row.id);
        Api.toast('已删除', 'success');
        this.loadRequests();
      } catch (e) { /* handled */ }
    },
    async sendOrder(row) {
      try {
        await this.$confirm(`确认下发采购订单 ${row.order_no}？下发后未到货数量将计入在途库存。`, '下发订单', {
          type: 'info', confirmButtonText: '确认下发', cancelButtonText: '取消'
        });
      } catch (e) { return; }
      try {
        await Api.post(`/purchase/orders/${row.id}/send`);
        Api.toast('订单已下发，在途库存已更新', 'success');
        this.loadOrders();
      } catch (e) { /* handled */ }
    },
    async receiveOrder(row) {
      try {
        await this.$confirm(`确认 ${row.order_no} 到货？系统将生成入库单，需在「入库管理」确认后才会增加库存。`, '收货', {
          type: 'info', confirmButtonText: '生成入库单', cancelButtonText: '取消'
        });
      } catch (e) { return; }
      try {
        const d = await Api.post(`/purchase/orders/${row.id}/receive`);
        Api.toast(`已生成入库单 ${d.order_no}`, 'success');
        this.loadOrders();
        location.hash = '#/orders/inbound';
      } catch (e) { /* handled */ }
    },
    async cancelOrder(row) {
      try {
        await this.$confirm(`确认取消采购订单 ${row.order_no}？在途数量将被回退。`, '取消订单', { type: 'warning' });
      } catch (e) { return; }
      try {
        await Api.post(`/purchase/orders/${row.id}/cancel`);
        Api.toast('订单已取消', 'success');
        this.loadOrders();
      } catch (e) { /* handled */ }
    },
    // ---------- 新建申请 ----------
    openCreate() {
      this.create = {
        visible: true, saving: false, title: '', remark: '',
        items: [{ component_id: null, quantity: 100, options: [], loading: false }]
      };
    },
    addItem() {
      this.create.items.push({ component_id: null, quantity: 100, options: [], loading: false });
    },
    removeItem(i) { this.create.items.splice(i, 1); },
    async searchComp(item, q) {
      item.loading = true;
      try {
        const d = await Api.get('/components', { keyword: q, page: 1, pageSize: 20 });
        item.options = d.list;
      } finally { item.loading = false; }
    },
    async saveCreate() {
      if (!this.create.title) return Api.toast('请填写申请标题', 'warning');
      const items = this.create.items.filter(i => i.component_id && i.quantity > 0);
      if (!items.length) return Api.toast('请至少添加一个有效明细', 'warning');
      this.create.saving = true;
      try {
        await Api.post('/purchase/requests', {
          title: this.create.title, remark: this.create.remark,
          items: items.map(i => ({ component_id: i.component_id, quantity: i.quantity }))
        });
        Api.toast('采购申请已创建（草稿）', 'success');
        this.create.visible = false;
        this.tab = 'requests';
        this.loadRequests();
      } catch (e) { /* handled */ } finally { this.create.saving = false; }
    }
  },
  mounted() {
    this.tab = this.route?.tab || 'requests';
    if (this.tab === 'orders') this.loadOrders(); else this.loadRequests();
  },
  template: `
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>{{ tab === 'requests' ? '采购申请' : '采购订单' }}</h1>
        <p class="page-sub">{{ tab === 'requests' ? '缺料补货申请与审批流转' : '按供应商下单、在途跟踪与收货' }}</p>
      </div>
      <div class="page-actions">
        <el-button v-if="tab === 'requests' && can('purchase:create')" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新建申请
        </el-button>
      </div>
    </div>

    <el-tabs v-model="tab" @tab-change="switchTab">
      <el-tab-pane label="采购申请" name="requests">
        <div class="filter-bar">
          <el-input v-model="reqFilters.keyword" placeholder="搜索申请单号 / 标题" clearable style="width:230px"
                    @keyup.enter="loadRequests" @clear="loadRequests">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="reqFilters.status" placeholder="全部状态" clearable style="width:140px" @change="loadRequests">
            <el-option label="草稿" value="draft" />
            <el-option label="待审批" value="pending" />
            <el-option label="已审批" value="approved" />
            <el-option label="已驳回" value="rejected" />
            <el-option label="已下单" value="ordered" />
          </el-select>
          <div class="spacer"></div>
          <el-button @click="reqFilters = { keyword: '', status: '' }; loadRequests()">重置</el-button>
          <el-button type="primary" @click="loadRequests">查询</el-button>
        </div>

        <div class="table-card">
          <el-table :data="requests" v-loading="reqLoading" style="width:100%">
            <el-table-column label="申请单号" width="168">
              <template #default="{ row }">
                <span class="mono hover-link" @click="openRequest(row)">{{ row.request_no }}</span>
              </template>
            </el-table-column>
            <el-table-column label="标题" min-width="230">
              <template #default="{ row }">
                <div class="cell-main">{{ row.title }}</div>
                <div class="cell-sub">{{ row.source === 'bom_analysis' ? '来源：BOM 缺料分析' : '来源：手工申请' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="明细" width="90" align="right">
              <template #default="{ row }"><span class="num">{{ row.item_count }} 项</span></template>
            </el-table-column>
            <el-table-column label="申请数量" width="110" align="right">
              <template #default="{ row }"><span class="num">{{ fmtQty(row.total_qty) }}</span></template>
            </el-table-column>
            <el-table-column prop="applicant_name" label="申请人" width="90" />
            <el-table-column label="状态" width="112">
              <template #default="{ row }"><span class="pill" :class="pill(row.status).color">{{ pill(row.status).text }}</span></template>
            </el-table-column>
            <el-table-column label="创建时间" width="140">
              <template #default="{ row }"><span class="muted num">{{ fmtDateTime(row.created_at) }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="210" align="center" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openRequest(row)">详情</el-button>
                <el-button v-if="row.status === 'draft'" link type="primary" @click="submitRequest(row)">提交</el-button>
                <el-button v-if="row.status === 'pending' && can('purchase:approve')" link type="primary" @click="openApprove(row)">审批</el-button>
                <el-button v-if="row.status === 'approved' && can('purchase:order')" link type="primary" @click="toOrders(row)">生成订单</el-button>
                <el-button v-if="['draft','rejected'].includes(row.status)" link type="danger" @click="deleteRequest(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <span class="info">共 {{ reqTotal }} 条记录</span>
            <el-pagination background layout="prev, pager, next, sizes" :total="reqTotal"
              v-model:current-page="reqPage" v-model:page-size="reqPageSize" :page-sizes="[15, 30, 50]"
              @current-change="loadRequests" @size-change="loadRequests" />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="采购订单" name="orders">
        <div class="filter-bar">
          <el-input v-model="ordFilters.keyword" placeholder="搜索订单号 / 供应商" clearable style="width:230px"
                    @keyup.enter="loadOrders" @clear="loadOrders">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="ordFilters.status" placeholder="全部状态" clearable style="width:140px" @change="loadOrders">
            <el-option label="草稿" value="draft" />
            <el-option label="已下发" value="sent" />
            <el-option label="部分到货" value="partial" />
            <el-option label="已完成" value="received" />
            <el-option label="已取消" value="cancelled" />
          </el-select>
          <div class="spacer"></div>
          <el-button @click="ordFilters = { keyword: '', status: '' }; loadOrders()">重置</el-button>
          <el-button type="primary" @click="loadOrders">查询</el-button>
        </div>

        <div class="table-card">
          <el-table :data="orders" v-loading="ordLoading" style="width:100%">
            <el-table-column label="订单号" width="168">
              <template #default="{ row }">
                <span class="mono hover-link" @click="openOrder(row)">{{ row.order_no }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="supplier_name" label="供应商" min-width="180" show-overflow-tooltip />
            <el-table-column label="明细" width="76" align="right">
              <template #default="{ row }"><span class="num">{{ row.item_count }} 项</span></template>
            </el-table-column>
            <el-table-column label="订购 / 到货" width="140" align="right">
              <template #default="{ row }">
                <span class="num">{{ fmtQty(row.total_qty) }}</span>
                <span class="muted-2" style="font-size:11px"> / {{ fmtQty(row.received_qty) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="金额" width="120" align="right">
              <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtMoney(row.total_amount) }}</span></template>
            </el-table-column>
            <el-table-column label="预计到货" width="110">
              <template #default="{ row }"><span class="muted num">{{ fmtDate(row.expected_date) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="116">
              <template #default="{ row }"><span class="pill" :class="pill(row.status).color">{{ pill(row.status).text }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="190" align="center" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openOrder(row)">详情</el-button>
                <el-button v-if="row.status === 'draft' && can('purchase:order')" link type="primary" @click="sendOrder(row)">下发</el-button>
                <el-button v-if="['sent','partial'].includes(row.status) && can('stock:confirm')" link type="primary" @click="receiveOrder(row)">收货</el-button>
                <el-button v-if="!['received','cancelled'].includes(row.status) && can('purchase:order')" link type="danger" @click="cancelOrder(row)">取消</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <span class="info">共 {{ ordTotal }} 条记录</span>
            <el-pagination background layout="prev, pager, next, sizes" :total="ordTotal"
              v-model:current-page="ordPage" v-model:page-size="ordPageSize" :page-sizes="[15, 30, 50]"
              @current-change="loadOrders" @size-change="loadOrders" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 详情 -->
    <el-drawer v-model="detail.visible" size="720px" :title="detail.type === 'request' ? '采购申请详情' : '采购订单详情'" destroy-on-close>
      <div v-loading="detail.loading">
        <template v-if="detail.data">
          <!-- 申请 -->
          <template v-if="detail.type === 'request'">
            <div class="detail-hero">
              <div class="pn">{{ detail.data.request.request_no }}</div>
              <h3>{{ detail.data.request.title }}</h3>
              <div class="detail-tags">
                <span class="pill" :class="pill(detail.data.request.status).color">{{ pill(detail.data.request.status).text }}</span>
                <span class="pill gray no-dot">{{ detail.data.request.source === 'bom_analysis' ? 'BOM 缺料分析' : '手工申请' }}</span>
                <span class="pill gray no-dot">{{ detail.data.request.applicant_name }}</span>
              </div>
              <div class="detail-kpis" style="grid-template-columns:repeat(3,1fr)">
                <div class="detail-kpi"><div class="l">申请明细</div><div class="v">{{ detail.data.items.length }} 项</div></div>
                <div class="detail-kpi"><div class="l">申请总量</div><div class="v">{{ fmtQty(detail.data.items.reduce((a,i)=>a+Number(i.quantity),0)) }}</div></div>
                <div class="detail-kpi"><div class="l">已生成订单</div><div class="v">{{ detail.data.orders.length }} 张</div></div>
              </div>
            </div>
            <div style="padding:18px 22px">
              <div class="section-title">申请明细</div>
              <el-table :data="detail.data.items" size="small" style="width:100%">
                <el-table-column label="料号" min-width="140">
                  <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
                </el-table-column>
                <el-table-column prop="name" label="器件" min-width="110" />
                <el-table-column prop="model" label="型号" min-width="130" show-overflow-tooltip />
                <el-table-column label="数量" width="96" align="right">
                  <template #default="{ row }"><span class="num" style="font-weight:600">{{ fmtQty(row.quantity) }}</span></template>
                </el-table-column>
                <el-table-column label="现有库存" width="90" align="right">
                  <template #default="{ row }"><span class="num muted">{{ fmtQty(row.stock_qty) }}</span></template>
                </el-table-column>
              </el-table>

              <div class="section-title">流转记录</div>
              <div class="tl">
                <div class="tl-item done">
                  <div class="t">创建申请</div>
                  <div class="s">{{ detail.data.request.applicant_name }} · {{ fmtDateTime(detail.data.request.created_at) }}</div>
                </div>
                <div class="tl-item" :class="{ done: detail.data.request.status !== 'draft', active: detail.data.request.status === 'pending' }">
                  <div class="t">提交审批</div>
                  <div class="s">{{ detail.data.request.status === 'draft' ? '待提交' : '已提交' }}</div>
                </div>
                <div class="tl-item" :class="{ done: ['approved','ordered'].includes(detail.data.request.status), active: detail.data.request.status === 'pending' }">
                  <div class="t">审批{{ detail.data.request.status === 'rejected' ? '驳回' : '通过' }}</div>
                  <div class="s">
                    <template v-if="detail.data.request.approver_name">
                      {{ detail.data.request.approver_name }} · {{ fmtDateTime(detail.data.request.approved_at) }}
                      <template v-if="detail.data.request.approve_remark"> · {{ detail.data.request.approve_remark }}</template>
                    </template>
                    <template v-else>待审批</template>
                  </div>
                </div>
                <div class="tl-item" :class="{ done: detail.data.request.status === 'ordered' }">
                  <div class="t">生成采购订单</div>
                  <div class="s">{{ detail.data.orders.length ? detail.data.orders.map(o => o.order_no).join('、') : '未生成' }}</div>
                </div>
              </div>
              <div v-if="detail.data.request.remark" style="margin-top:14px">
                <div class="section-title">备注</div>
                <div class="muted" style="font-size:12.5px;line-height:1.8">{{ detail.data.request.remark }}</div>
              </div>
            </div>
          </template>

          <!-- 订单 -->
          <template v-else>
            <div class="detail-hero">
              <div class="pn">{{ detail.data.order.order_no }}</div>
              <h3>{{ detail.data.order.supplier_name || '未指定供应商' }}</h3>
              <div class="detail-tags">
                <span class="pill" :class="pill(detail.data.order.status).color">{{ pill(detail.data.order.status).text }}</span>
                <span class="pill gray no-dot">预计 {{ fmtDate(detail.data.order.expected_date) }}</span>
              </div>
              <div class="detail-kpis" style="grid-template-columns:repeat(3,1fr)">
                <div class="detail-kpi"><div class="l">订单金额</div><div class="v">{{ fmtMoney(detail.data.order.total_amount) }}</div></div>
                <div class="detail-kpi"><div class="l">明细项</div><div class="v">{{ detail.data.items.length }}</div></div>
                <div class="detail-kpi"><div class="l">已到货</div><div class="v">{{ fmtQty(detail.data.items.reduce((a,i)=>a+Number(i.received_qty),0)) }}</div></div>
              </div>
            </div>
            <div style="padding:18px 22px">
              <div class="section-title">订单明细</div>
              <el-table :data="detail.data.items" size="small" style="width:100%">
                <el-table-column label="料号" min-width="140">
                  <template #default="{ row }"><span class="mono">{{ row.part_number }}</span></template>
                </el-table-column>
                <el-table-column prop="name" label="器件" min-width="110" />
                <el-table-column label="订购" width="86" align="right">
                  <template #default="{ row }"><span class="num">{{ fmtQty(row.quantity) }}</span></template>
                </el-table-column>
                <el-table-column label="到货" width="86" align="right">
                  <template #default="{ row }">
                    <span class="num" :class="Number(row.received_qty) >= Number(row.quantity) ? 'ok' : 'muted'">{{ fmtQty(row.received_qty) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="单价" width="94" align="right">
                  <template #default="{ row }"><span class="num">{{ fmtMoney(row.unit_price, 4) }}</span></template>
                </el-table-column>
                <el-table-column label="金额" width="104" align="right">
                  <template #default="{ row }"><span class="num">{{ fmtMoney(Number(row.quantity) * Number(row.unit_price)) }}</span></template>
                </el-table-column>
              </el-table>
              <div class="soft-divider"></div>
              <el-descriptions :column="2" size="small">
                <el-descriptions-item label="创建人">{{ detail.data.order.creator_name || '—' }}</el-descriptions-item>
                <el-descriptions-item label="创建时间">{{ fmtDateTime(detail.data.order.created_at) }}</el-descriptions-item>
                <el-descriptions-item label="下发时间">{{ detail.data.order.sent_at ? fmtDateTime(detail.data.order.sent_at) : '—' }}</el-descriptions-item>
                <el-descriptions-item label="备注">{{ detail.data.order.remark || '—' }}</el-descriptions-item>
              </el-descriptions>
            </div>
          </template>
        </template>
      </div>
      <template #footer>
        <el-button @click="detail.visible = false">关闭</el-button>
        <template v-if="detail.data && detail.type === 'request'">
          <el-button v-if="detail.data.request.status === 'draft'" type="primary" @click="submitRequest(detail.data.request); detail.visible = false">提交审批</el-button>
          <el-button v-if="detail.data.request.status === 'pending' && can('purchase:approve')" type="primary" @click="openApprove(detail.data.request)">审批</el-button>
          <el-button v-if="detail.data.request.status === 'approved' && can('purchase:order')" type="primary" @click="toOrders(detail.data.request); detail.visible = false">生成订单</el-button>
        </template>
        <template v-if="detail.data && detail.type === 'order'">
          <el-button v-if="detail.data.order.status === 'draft'" type="primary" @click="sendOrder(detail.data.order); detail.visible = false">下发订单</el-button>
          <el-button v-if="['sent','partial'].includes(detail.data.order.status)" type="primary" @click="receiveOrder(detail.data.order)">收货</el-button>
        </template>
      </template>
    </el-drawer>

    <!-- 审批 -->
    <el-dialog v-model="approve.visible" title="审批采购申请" width="460px" append-to-body>
      <template v-if="approve.row">
        <div class="file-chip" style="margin-bottom:14px">
          <el-icon><Document /></el-icon>
          <div>
            <div style="font-size:12.5px;font-weight:500">{{ approve.row.title }}</div>
            <div class="mono muted-2" style="font-size:11px">{{ approve.row.request_no }} · {{ approve.row.item_count }} 项</div>
          </div>
        </div>
        <el-form label-position="top">
          <el-form-item label="审批结论">
            <el-radio-group v-model="approve.approve">
              <el-radio-button :value="true">通过</el-radio-button>
              <el-radio-button :value="false">驳回</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="审批意见"><el-input v-model="approve.remark" type="textarea" :rows="2" placeholder="选填" /></el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="approve.visible = false">取消</el-button>
        <el-button type="primary" :loading="approve.saving" @click="doApprove">提交审批</el-button>
      </template>
    </el-dialog>

    <!-- 新建申请 -->
    <el-dialog v-model="create.visible" title="新建采购申请" width="760px" append-to-body :close-on-click-modal="false">
      <el-form label-position="top">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
          <el-form-item label="申请标题" required><el-input v-model="create.title" placeholder="如 常用阻容件备货" /></el-form-item>
          <el-form-item label="备注"><el-input v-model="create.remark" placeholder="选填" /></el-form-item>
        </div>
      </el-form>
      <div class="flex-between" style="margin:6px 0 10px">
        <span class="section-title" style="margin:0">采购明细</span>
        <el-button size="small" @click="addItem"><el-icon><Plus /></el-icon>添加一行</el-button>
      </div>
      <div v-for="(it, i) in create.items" :key="i" style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
        <el-select v-model="it.component_id" filterable remote :remote-method="q => searchComp(it, q)"
                   :loading="it.loading" placeholder="搜索料号 / 型号" style="flex:1">
          <el-option v-for="c in it.options" :key="c.id" :label="c.part_number + ' · ' + c.name + ' / ' + (c.model||'')" :value="c.id" />
        </el-select>
        <el-input-number v-model="it.quantity" :min="1" style="width:150px" />
        <el-button text type="danger" @click="removeItem(i)" :disabled="create.items.length === 1"><el-icon><Delete /></el-icon></el-button>
      </div>
      <el-alert type="info" :closable="false" title="创建后为草稿状态，需提交审批；审批通过后可按供应商拆分生成采购订单。" />
      <template #footer>
        <el-button @click="create.visible = false">取消</el-button>
        <el-button type="primary" :loading="create.saving" @click="saveCreate">创建申请</el-button>
      </template>
    </el-dialog>
  </div>
  `
};
