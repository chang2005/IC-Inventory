/** 应用外壳：路由 + 布局 + 权限 */
const Store = Vue.reactive({
  user: JSON.parse(localStorage.getItem('qjcrk_user') || 'null'),
  perms: JSON.parse(localStorage.getItem('qjcrk_perms') || '[]'),
  route: { name: 'dashboard', params: {}, full: '/dashboard', title: '工作台', group: '概览' },
  meta: { categories: [], suppliers: [], brands: [] },
  warningCount: 0,
  collapsed: localStorage.getItem('qjcrk_collapsed') === '1',
  refreshKey: 0,
  today: ''
});
window.Store = Store;

const ROUTES = [
  { path: '/dashboard', name: 'dashboard', title: '工作台', group: '概览', icon: 'Odometer', comp: 'page-dashboard', perm: 'report:view', desc: '库存健康度、待办与关键指标总览' },
  { path: '/components', name: 'components', title: '器件档案', group: '库存', icon: 'Box', comp: 'page-components', perm: 'comp:view', desc: '料号、品牌、型号、封装与安全库存维护' },
  { path: '/stock', name: 'stock', title: '库存管理', group: '库存', icon: 'Coin', comp: 'page-stock', perm: 'stock:view', desc: '实时库存、出入库流水与循环盘点' },
  { path: '/bom', name: 'bom', title: 'BOM 与缺料分析', group: '库存', icon: 'Grid', comp: 'page-bom', perm: 'bom:view', desc: 'BOM 导入、自动匹配与缺料计算' },
  { path: '/bom/:id', name: 'bom-detail', title: 'BOM 详情', group: '库存', icon: 'Grid', comp: 'page-bom', perm: 'bom:view', desc: 'BOM 明细与缺料分析结果' },
  { path: '/purchase/requests', name: 'purchase-requests', title: '采购申请', group: '采购', icon: 'DocumentAdd', comp: 'page-purchase', perm: 'purchase:view', tab: 'requests', desc: '缺料补货申请与审批流转' },
  { path: '/purchase/orders', name: 'purchase-orders', title: '采购订单', group: '采购', icon: 'Tickets', comp: 'page-purchase', perm: 'purchase:view', tab: 'orders', desc: '按供应商下单、在途跟踪与收货' },
  { path: '/orders/inbound', name: 'inbound', title: '入库管理', group: '单据', icon: 'Download', comp: 'page-orders', perm: 'stock:view', orderType: 'inbound', desc: '采购到货、退料入库与批次登记' },
  { path: '/orders/outbound', name: 'outbound', title: '出库管理', group: '单据', icon: 'Upload', comp: 'page-orders', perm: 'stock:view', orderType: 'outbound', desc: '生产领料、借用与报废出库' },
  { path: '/reports', name: 'reports', title: '报表中心', group: '分析', icon: 'TrendCharts', comp: 'page-reports', perm: 'report:view', desc: '库存结构、消耗趋势与采购分析' },
  { path: '/system/users', name: 'users', title: '用户管理', group: '系统', icon: 'User', comp: 'page-users', perm: 'sys:user:view', desc: '账号、角色与权限维护' },
  { path: '/system/logs', name: 'logs', title: '操作日志', group: '系统', icon: 'Document', comp: 'page-logs', perm: 'sys:log', desc: '关键业务动作审计追踪' },
  { path: '/system/masters', name: 'masters', title: '基础资料', group: '系统', icon: 'Collection', comp: 'page-masters', perm: 'sys:master', desc: '供应商与器件分类维护' }
];

function parseHash() {
  const raw = (location.hash || '#/dashboard').replace(/^#/, '') || '/dashboard';
  const parts = raw.split('?')[0].split('/').filter(Boolean);
  for (const r of ROUTES) {
    const rp = r.path.split('/').filter(Boolean);
    if (rp.length !== parts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (rp[i] !== parts[i]) { matched = false; break; }
    }
    if (matched) return { ...r, params, full: raw };
  }
  return { ...ROUTES[0], params: {}, full: raw };
}

function can(perm) {
  if (!perm) return true;
  const list = Store.perms || [];
  return list.includes('*') || list.includes(perm);
}

const AppRoot = {
  name: 'AppRoot',
  data() {
    return {
      store: Store,
      pwdVisible: false,
      pwdSaving: false,
      pwd: { old_password: '', new_password: '', confirm: '' },
      clock: ''
    };
  },
  computed: {
    route() { return Store.route; },
    menuGroups() {
      const order = ['概览', '库存', '采购', '单据', '分析', '系统'];
      const groups = [];
      order.forEach(g => {
        const items = ROUTES.filter(r => r.group === g && !r.path.includes(':') && can(r.perm));
        if (items.length) groups.push({ name: g, items });
      });
      return groups;
    },
    initials() {
      const n = Store.user?.real_name || Store.user?.username || '';
      return n.slice(-2);
    }
  },
  methods: {
    can,
    fmtQty: Utils.fmtQty,
    go(path) { location.hash = '#' + path; },
    logout() {
      Api.setToken('');
      localStorage.removeItem('qjcrk_user');
      localStorage.removeItem('qjcrk_perms');
      Store.user = null;
      Store.perms = [];
      location.hash = '#/login';
    },
    onLogin() {
      location.hash = '#/dashboard';
      this.refreshWarning();
    },
    toggleSidebar() {
      Store.collapsed = !Store.collapsed;
      localStorage.setItem('qjcrk_collapsed', Store.collapsed ? '1' : '0');
    },
    refresh() { Store.refreshKey++; this.refreshWarning(); },
    scrollTop() { window.scrollTo(0, 0); },
    async refreshWarning() {
      if (!Store.user) return;
      try {
        const d = await Api.get('/stock', { only_warning: 1, page: 1, pageSize: 1 }, { silent: true });
        Store.warningCount = d.stats?.warning || 0;
      } catch (e) { /* ignore */ }
    },
    async loadMeta() {
      if (!Store.user) return;
      try {
        const d = await Api.get('/components/meta', null, { silent: true });
        Store.meta = d;
      } catch (e) { /* ignore */ }
    },
    openPwd() {
      this.pwd = { old_password: '', new_password: '', confirm: '' };
      this.pwdVisible = true;
    },
    async savePwd() {
      if (!this.pwd.old_password || !this.pwd.new_password) return Api.toast('请填写完整', 'warning');
      if (this.pwd.new_password.length < 6) return Api.toast('新密码至少 6 位', 'warning');
      if (this.pwd.new_password !== this.pwd.confirm) return Api.toast('两次输入的新密码不一致', 'warning');
      this.pwdSaving = true;
      try {
        await Api.post('/auth/password', { old_password: this.pwd.old_password, new_password: this.pwd.new_password });
        Api.toast('密码修改成功', 'success');
        this.pwdVisible = false;
      } catch (e) { /* toast by api */ } finally { this.pwdSaving = false; }
    },
    groupIcon(name) {
      return { '概览': 'Odometer', '库存': 'Box', '采购': 'ShoppingCart', '单据': 'Tickets', '分析': 'DataLine', '系统': 'Setting' }[name] || 'Menu';
    }
  },
  mounted() {
    const tick = () => {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      this.clock = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    tick();
    setInterval(tick, 30000);

    const sync = () => {
      Store.route = parseHash();
      if (Store.user) {
        if (!can(Store.route.perm)) return;
        this.refreshWarning();
      }
    };
    window.addEventListener('hashchange', sync);
    if (!Store.user) {
      if (location.hash !== '#/login') location.hash = '#/login';
      Store.route = { ...ROUTES[0], params: {}, full: '/login' };
    } else {
      if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard';
      Store.route = parseHash();
      this.loadMeta();
      this.refreshWarning();
    }
  },
  template: `
  <transition name="fade" mode="out-in">
  <div v-if="!store.user" key="login">
    <page-login @success="onLogin" />
  </div>
  <div v-else key="app" class="app-shell">
    <aside class="sidebar" :class="{ collapsed: store.collapsed }">
      <div class="sidebar-brand">
        <div class="brand-mark">QJ</div>
        <div class="brand-txt">
          <div class="n">元器件供应链</div>
          <div class="s">IC SUPPLY CHAIN</div>
        </div>
      </div>
      <div class="nav-scroll">
        <template v-for="g in menuGroups" :key="g.name">
          <div class="nav-group-label">{{ g.name }}</div>
          <div v-for="m in g.items" :key="m.name" class="nav-item"
               :class="{ active: route.name === m.name || (m.name === 'bom' && route.name === 'bom-detail') }"
               @click="go(m.path)" :title="m.title">
            <el-icon><component :is="m.icon" /></el-icon>
            <span class="label">{{ m.title }}</span>
            <span v-if="m.name === 'stock' && store.warningCount" class="count">{{ store.warningCount }}</span>
          </div>
        </template>
      </div>
      <div class="sidebar-foot">
        <button class="collapse-btn" @click="toggleSidebar">
          <el-icon><component :is="store.collapsed ? 'DArrowRight' : 'DArrowLeft'" /></el-icon>
          <span v-if="!store.collapsed">收起导航</span>
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumb">
          <span>{{ route.group || '概览' }}</span>
          <span class="sep">/</span>
          <transition name="fade" mode="out-in">
            <span class="cur" :key="route.name">{{ route.title }}</span>
          </transition>
        </div>
        <div class="top-actions">
          <span class="muted-2 num" style="font-size:11.5px;margin-right:8px">{{ clock }}</span>
          <el-tooltip content="刷新当前页" placement="bottom">
            <button class="icon-btn" @click="refresh"><el-icon><Refresh /></el-icon></button>
          </el-tooltip>
          <el-tooltip content="安全库存预警" placement="bottom">
            <button class="icon-btn" @click="go('/stock?warning=1')">
              <el-icon><Bell /></el-icon>
              <span v-if="store.warningCount" class="dot-badge">{{ store.warningCount > 99 ? '99+' : store.warningCount }}</span>
            </button>
          </el-tooltip>
          <el-dropdown trigger="click" @command="c => c === 'pwd' ? openPwd() : logout()">
            <div class="user-chip">
              <div class="avatar">{{ initials }}</div>
              <div class="user-meta">
                <div class="n">{{ store.user.real_name || store.user.username }}</div>
                <div class="r">{{ store.user.role_label }}<template v-if="store.user.dept"> · {{ store.user.dept }}</template></div>
              </div>
              <el-icon style="font-size:12px;color:#94a3b8"><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="pwd"><el-icon><Lock /></el-icon>修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided><el-icon><SwitchButton /></el-icon>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="content">
        <div v-if="!can(route.perm)" class="panel" style="padding:60px;text-align:center">
          <div style="font-size:34px;color:#cbd5e1;margin-bottom:12px">403</div>
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">无访问权限</div>
          <div class="muted" style="font-size:12.5px">当前角色（{{ store.user.role_label }}）没有该模块的访问权限，请联系超级管理员。</div>
        </div>
        <transition v-else name="page" mode="out-in" @after-leave="scrollTop">
          <component :is="route.comp" :key="route.full + '#' + store.refreshKey"
                     :params="route.params" :route="route" />
        </transition>
      </main>
    </div>

    <el-dialog v-model="pwdVisible" title="修改登录密码" width="420px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="原密码"><el-input v-model="pwd.old_password" type="password" show-password placeholder="请输入当前密码" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="pwd.new_password" type="password" show-password placeholder="至少 6 位" /></el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="pwd.confirm" type="password" show-password placeholder="再次输入新密码" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdSaving" @click="savePwd">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
  </transition>
  `
};

const app = Vue.createApp(AppRoot);
for (const [key, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, comp);
}
app.use(ElementPlus, { locale: window.ElementPlusLocaleZhCn || undefined });
for (const [name, comp] of Object.entries(window.Pages || {})) {
  app.component(name, comp);
}
app.config.globalProperties.$fmt = Utils;
app.config.globalProperties.can = can;
app.config.globalProperties.Store = Store;
app.mount('#app');
