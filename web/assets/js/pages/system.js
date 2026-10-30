window.Pages = window.Pages || {};

const ROLE_META = {
  super_admin: { text: '超级管理员', color: 'purple' },
  admin: { text: '管理员', color: 'blue' },
  employee: { text: '员工', color: 'gray' }
};
const MODULE_META = {
  auth: '认证', component: '器件', stock: '库存', bom: 'BOM', purchase: '采购', system: '系统'
};

// ==================== 用户管理 ====================
window.Pages['page-users'] = {
  name: 'page-users',
  data() {
    return {
      loading: false,
      list: [],
      total: 0,
      page: 1,
      pageSize: 15,
      filters: { keyword: '', role: '', status: '' },
      edit: { visible: false, saving: false, isNew: true, form: {} },
      reset: { visible: false, row: null, password: '', saving: false }
    };
  },
  methods: {
    fmtDateTime: Utils.fmtDateTime,
    roleMeta(r) { return ROLE_META[r] || { text: r, color: 'gray' }; },
    async load() {
      this.loading = true;
      try {
        const d = await Api.get('/system/users', {
          page: this.page, pageSize: this.pageSize,
          keyword: this.filters.keyword, role: this.filters.role, status: this.filters.status
        });
        this.list = d.list;
        this.total = d.total;
      } finally { this.loading = false; }
    },
    openCreate() {
      this.edit = {
        visible: true, saving: false, isNew: true,
        form: { username: '', password: '123456', real_name: '', role: 'employee', dept: '', email: '', phone: '', status: 1 }
      };
    },
    openEdit(row) {
      this.edit = { visible: true, saving: false, isNew: false, form: { ...row } };
    },
    async save() {
      const f = this.edit.form;
      if (!f.username || !f.real_name) return Api.toast('账号与姓名必填', 'warning');
      this.edit.saving = true;
      try {
        if (this.edit.isNew) {
          if (!f.password || f.password.length < 6) { this.edit.saving = false; return Api.toast('初始密码至少 6 位', 'warning'); }
          await Api.post('/system/users', f);
        } else {
          await Api.put('/system/users/' + f.id, f);
        }
        Api.toast('保存成功', 'success');
        this.edit.visible = false;
        this.load();
      } catch (e) { /* handled */ } finally { this.edit.saving = false; }
    },
    openReset(row) {
      this.reset = { visible: true, row, password: '', saving: false };
    },
    async doReset() {
      if (!this.reset.password || this.reset.password.length < 6) return Api.toast('新密码至少 6 位', 'warning');
      this.reset.saving = true;
      try {
        await Api.post(`/system/users/${this.reset.row.id}/reset-password`, { password: this.reset.password });
        Api.toast('密码已重置', 'success');
        this.reset.visible = false;
      } catch (e) { /* handled */ } finally { this.reset.saving = false; }
    },
    async disable(row) {
      try {
        await this.$confirm(`确认停用账号「${row.username}」？停用后该用户将无法登录。`, '停用账号', { type: 'warning' });
      } catch (e) { return; }
      try {
        await Api.del('/system/users/' + row.id);
        Api.toast('账号已停用', 'success');
        this.load();
      } catch (e) { /* handled */ }
    }
  },
  mounted() { this.load(); },
  template: `
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>用户管理</h1>
        <p class="page-sub">账号、角色与权限维护 · 系统保留至少一个超级管理员</p>
      </div>
      <div class="page-actions">
        <el-button v-if="can('sys:user')" type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新增用户</el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input v-model="filters.keyword" placeholder="搜索账号 / 姓名 / 部门" clearable style="width:220px"
                @keyup.enter="load" @clear="load">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="filters.role" placeholder="全部角色" clearable style="width:140px" @change="load">
        <el-option label="超级管理员" value="super_admin" />
        <el-option label="管理员" value="admin" />
        <el-option label="员工" value="employee" />
      </el-select>
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width:120px" @change="load">
        <el-option label="启用" value="1" />
        <el-option label="停用" value="0" />
      </el-select>
      <div class="spacer"></div>
      <el-button @click="filters = { keyword: '', role: '', status: '' }; load()">重置</el-button>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" style="width:100%">
        <el-table-column label="账号" width="130">
          <template #default="{ row }"><span class="mono">{{ row.username }}</span></template>
        </el-table-column>
        <el-table-column label="姓名" width="136">
          <template #default="{ row }">
            <div class="flex gap-8">
              <div class="avatar" style="width:26px;height:26px;flex-basis:26px;font-size:10px">{{ (row.real_name||'').slice(-2) }}</div>
              <span>{{ row.real_name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="124">
          <template #default="{ row }">
            <span class="pill" :class="roleMeta(row.role).color">{{ roleMeta(row.role).text }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="dept" label="部门" width="100" />
        <el-table-column prop="email" label="邮箱" min-width="140" show-overflow-tooltip />
        <el-table-column prop="phone" label="手机" width="112" />
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <span class="pill" :class="row.status === 1 ? 'green' : 'gray'">{{ row.status === 1 ? '启用' : '停用' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="140">
          <template #default="{ row }"><span class="muted num">{{ row.last_login_at ? fmtDateTime(row.last_login_at) : '从未登录' }}</span></template>
        </el-table-column>
        <el-table-column v-if="can('sys:user')" label="操作" width="168" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="primary" @click="openReset(row)">重置密码</el-button>
            <el-button v-if="row.status === 1" link type="danger" @click="disable(row)">停用</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <span class="info">共 {{ total }} 条记录</span>
        <el-pagination background layout="prev, pager, next" :total="total"
          v-model:current-page="page" :page-size="pageSize" @current-change="load" />
      </div>
    </div>

    <el-dialog v-model="edit.visible" :title="edit.isNew ? '新增用户' : '编辑用户'" width="560px" append-to-body>
      <el-form label-position="top">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
          <el-form-item label="登录账号" required><el-input v-model="edit.form.username" :disabled="!edit.isNew" /></el-form-item>
          <el-form-item v-if="edit.isNew" label="初始密码" required><el-input v-model="edit.form.password" placeholder="至少 6 位" /></el-form-item>
          <el-form-item label="姓名" required><el-input v-model="edit.form.real_name" /></el-form-item>
          <el-form-item label="角色">
            <el-select v-model="edit.form.role" style="width:100%">
              <el-option label="超级管理员" value="super_admin" />
              <el-option label="管理员" value="admin" />
              <el-option label="员工" value="employee" />
            </el-select>
          </el-form-item>
          <el-form-item label="部门"><el-input v-model="edit.form.dept" /></el-form-item>
          <el-form-item label="邮箱"><el-input v-model="edit.form.email" /></el-form-item>
          <el-form-item label="手机"><el-input v-model="edit.form.phone" /></el-form-item>
          <el-form-item label="状态">
            <el-switch v-model="edit.form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="edit.visible = false">取消</el-button>
        <el-button type="primary" :loading="edit.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reset.visible" title="重置密码" width="420px" append-to-body>
      <el-form label-position="top">
        <el-form-item :label="'为「' + (reset.row?.real_name || '') + '」设置新密码'">
          <el-input v-model="reset.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reset.visible = false">取消</el-button>
        <el-button type="primary" :loading="reset.saving" @click="doReset">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
  `
};

// ==================== 操作日志 ====================
window.Pages['page-logs'] = {
  name: 'page-logs',
  data() {
    return {
      loading: false,
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
      filters: { keyword: '', module: '', range: [] },
      modules: []
    };
  },
  methods: {
    fmtDateTime: Utils.fmtDateTime,
    moduleText(m) { return MODULE_META[m] || m; },
    async load() {
      this.loading = true;
      try {
        const d = await Api.get('/system/logs', {
          page: this.page, pageSize: this.pageSize,
          keyword: this.filters.keyword, module: this.filters.module,
          start: this.filters.range?.[0] || '', end: this.filters.range?.[1] || ''
        });
        this.list = d.list;
        this.total = d.total;
        this.modules = d.modules;
      } finally { this.loading = false; }
    },
    reset() {
      this.filters = { keyword: '', module: '', range: [] };
      this.page = 1;
      this.load();
    }
  },
  mounted() { this.load(); },
  template: `
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>操作日志</h1>
        <p class="page-sub">关键业务动作审计追踪，记录操作人、时间与来源 IP</p>
      </div>
      <div class="page-actions">
        <el-button @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input v-model="filters.keyword" placeholder="搜索用户 / 动作 / 详情" clearable style="width:230px"
                @keyup.enter="load" @clear="load">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="filters.module" placeholder="全部模块" clearable style="width:130px" @change="load">
        <el-option v-for="m in modules" :key="m" :label="moduleText(m)" :value="m" />
      </el-select>
      <el-date-picker v-model="filters.range" type="daterange" value-format="YYYY-MM-DD"
        start-placeholder="开始日期" end-placeholder="结束日期" style="width:250px" @change="load" />
      <div class="spacer"></div>
      <el-button @click="reset">重置</el-button>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" style="width:100%">
        <el-table-column label="时间" width="150">
          <template #default="{ row }"><span class="muted num">{{ fmtDateTime(row.created_at) }}</span></template>
        </el-table-column>
        <el-table-column label="操作人" width="110">
          <template #default="{ row }">{{ row.username || '系统' }}</template>
        </el-table-column>
        <el-table-column label="模块" width="92">
          <template #default="{ row }"><span class="pill gray no-dot">{{ moduleText(row.module) }}</span></template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="110" />
        <el-table-column prop="detail" label="详情" min-width="320" show-overflow-tooltip />
        <el-table-column prop="ip" label="来源 IP" width="140">
          <template #default="{ row }"><span class="mono muted">{{ row.ip }}</span></template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <span class="info">共 {{ total }} 条记录</span>
        <el-pagination background layout="prev, pager, next, sizes" :total="total"
          v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[20, 50, 100]"
          @current-change="load" @size-change="load" />
      </div>
    </div>
  </div>
  `
};

// ==================== 基础资料 ====================
window.Pages['page-masters'] = {
  name: 'page-masters',
  data() {
    return {
      tab: 'suppliers',
      supLoading: false,
      suppliers: [],
      catLoading: false,
      categories: [],
      supDlg: { visible: false, saving: false, isNew: true, form: {} },
      catDlg: { visible: false, saving: false, isNew: true, form: {} }
    };
  },
  methods: {
    fmtMoney: Utils.fmtMoney,
    async loadSuppliers() {
      this.supLoading = true;
      try {
        const d = await Api.get('/system/suppliers');
        this.suppliers = d.list;
      } finally { this.supLoading = false; }
    },
    async loadCategories() {
      this.catLoading = true;
      try {
        const d = await Api.get('/system/categories');
        this.categories = d.list;
      } finally { this.catLoading = false; }
    },
    switchTab(name) {
      if (name === 'suppliers') this.loadSuppliers();
      else this.loadCategories();
    },
    openSup(row) {
      this.supDlg = {
        visible: true, saving: false, isNew: !row,
        form: row ? { ...row } : { code: '', name: '', contact: '', phone: '', email: '', address: '', rating: 4, remark: '' }
      };
    },
    async saveSup() {
      const f = this.supDlg.form;
      if (!f.name) return Api.toast('供应商名称必填', 'warning');
      this.supDlg.saving = true;
      try {
        if (this.supDlg.isNew) await Api.post('/system/suppliers', f);
        else await Api.put('/system/suppliers/' + f.id, f);
        Api.toast('保存成功', 'success');
        this.supDlg.visible = false;
        this.loadSuppliers();
      } catch (e) { /* handled */ } finally { this.supDlg.saving = false; }
    },
    async delSup(row) {
      try {
        await this.$confirm(`确认删除供应商「${row.name}」？`, '删除供应商', { type: 'warning' });
      } catch (e) { return; }
      try {
        await Api.del('/system/suppliers/' + row.id);
        Api.toast('已删除', 'success');
        this.loadSuppliers();
      } catch (e) { /* handled */ }
    },
    openCat(row) {
      this.catDlg = {
        visible: true, saving: false, isNew: !row,
        form: row ? { ...row } : { name: '', code: '', sort: 99 }
      };
    },
    async saveCat() {
      const f = this.catDlg.form;
      if (!f.name) return Api.toast('分类名称必填', 'warning');
      this.catDlg.saving = true;
      try {
        if (this.catDlg.isNew) await Api.post('/system/categories', f);
        else await Api.put('/system/categories/' + f.id, f);
        Api.toast('保存成功', 'success');
        this.catDlg.visible = false;
        this.loadCategories();
        Store.meta = await Api.get('/components/meta', null, { silent: true });
      } catch (e) { /* handled */ } finally { this.catDlg.saving = false; }
    },
    async delCat(row) {
      try {
        await this.$confirm(`确认删除分类「${row.name}」？`, '删除分类', { type: 'warning' });
      } catch (e) { return; }
      try {
        await Api.del('/system/categories/' + row.id);
        Api.toast('已删除', 'success');
        this.loadCategories();
        Store.meta = await Api.get('/components/meta', null, { silent: true });
      } catch (e) { /* handled */ }
    }
  },
  mounted() { this.loadSuppliers(); },
  template: `
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title"><span class="rule"></span>基础资料</h1>
        <p class="page-sub">供应商档案与器件分类维护</p>
      </div>
    </div>

    <el-tabs v-model="tab" @tab-change="switchTab">
      <el-tab-pane label="供应商" name="suppliers">
        <div class="filter-bar">
          <span class="muted" style="font-size:12.5px">供应商用于采购订单拆分与器件报价维护</span>
          <div class="spacer"></div>
          <el-button type="primary" @click="openSup(null)"><el-icon><Plus /></el-icon>新增供应商</el-button>
        </div>
        <div class="table-card">
          <el-table :data="suppliers" v-loading="supLoading" style="width:100%">
            <el-table-column label="编码" width="100">
              <template #default="{ row }"><span class="mono">{{ row.code }}</span></template>
            </el-table-column>
            <el-table-column label="供应商名称" min-width="210">
              <template #default="{ row }"><span style="font-weight:500">{{ row.name }}</span></template>
            </el-table-column>
            <el-table-column prop="contact" label="联系人" width="86" />
            <el-table-column prop="phone" label="电话" width="130" />
            <el-table-column prop="email" label="邮箱" min-width="160" show-overflow-tooltip />
            <el-table-column label="评级" width="118">
              <template #default="{ row }"><el-rate :model-value="row.rating" disabled size="small" /></template>
            </el-table-column>
            <el-table-column label="关联器件" width="84" align="right">
              <template #default="{ row }"><span class="num">{{ row.component_count }}</span></template>
            </el-table-column>
            <el-table-column label="累计采购" width="110" align="right">
              <template #default="{ row }"><span class="num">{{ fmtMoney(row.purchase_amount) }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="110" align="center" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openSup(row)">编辑</el-button>
                <el-button link type="danger" @click="delSup(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="器件分类" name="categories">
        <div class="filter-bar">
          <span class="muted" style="font-size:12.5px">分类用于库存结构与报表统计</span>
          <div class="spacer"></div>
          <el-button type="primary" @click="openCat(null)"><el-icon><Plus /></el-icon>新增分类</el-button>
        </div>
        <div class="table-card">
          <el-table :data="categories" v-loading="catLoading" style="width:100%">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column label="分类名称" min-width="180">
              <template #default="{ row }"><span style="font-weight:500">{{ row.name }}</span></template>
            </el-table-column>
            <el-table-column prop="code" label="编码" width="130">
              <template #default="{ row }"><span class="mono">{{ row.code || '—' }}</span></template>
            </el-table-column>
            <el-table-column label="器件数" width="100" align="right">
              <template #default="{ row }"><span class="num">{{ row.component_count }}</span></template>
            </el-table-column>
            <el-table-column prop="sort" label="排序" width="90" align="right" />
            <el-table-column label="操作" width="120" align="center">
              <template #default="{ row }">
                <el-button link type="primary" @click="openCat(row)">编辑</el-button>
                <el-button link type="danger" @click="delCat(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="supDlg.visible" :title="supDlg.isNew ? '新增供应商' : '编辑供应商'" width="600px" append-to-body>
      <el-form label-position="top">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
          <el-form-item label="供应商编码"><el-input v-model="supDlg.form.code" placeholder="留空自动生成" /></el-form-item>
          <el-form-item label="供应商名称" required><el-input v-model="supDlg.form.name" /></el-form-item>
          <el-form-item label="联系人"><el-input v-model="supDlg.form.contact" /></el-form-item>
          <el-form-item label="电话"><el-input v-model="supDlg.form.phone" /></el-form-item>
          <el-form-item label="邮箱"><el-input v-model="supDlg.form.email" /></el-form-item>
          <el-form-item label="评级"><el-rate v-model="supDlg.form.rating" /></el-form-item>
        </div>
        <el-form-item label="地址"><el-input v-model="supDlg.form.address" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="supDlg.form.remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="supDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="supDlg.saving" @click="saveSup">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="catDlg.visible" :title="catDlg.isNew ? '新增分类' : '编辑分类'" width="440px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="分类名称" required><el-input v-model="catDlg.form.name" /></el-form-item>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
          <el-form-item label="编码"><el-input v-model="catDlg.form.code" placeholder="如 RES" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="catDlg.form.sort" :min="1" style="width:100%" /></el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="catDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="catDlg.saving" @click="saveCat">保存</el-button>
      </template>
    </el-dialog>
  </div>
  `
};
