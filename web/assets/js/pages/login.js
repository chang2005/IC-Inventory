window.Pages = window.Pages || {};

window.Pages['page-login'] = {
  name: 'page-login',
  data() {
    return {
      loading: false,
      form: { username: '', password: '' }
    };
  },
  methods: {
    async submit() {
      if (!this.form.username || !this.form.password) return Api.toast('请输入账号和密码', 'warning');
      this.loading = true;
      try {
        const d = await Api.post('/auth/login', this.form);
        Api.setToken(d.token);
        localStorage.setItem('qjcrk_user', JSON.stringify(d.user));
        localStorage.setItem('qjcrk_perms', JSON.stringify(d.permissions));
        Store.user = d.user;
        Store.perms = d.permissions;
        Api.toast(`欢迎回来，${d.user.real_name || d.user.username}`, 'success');
        this.$emit('success');
      } catch (e) { /* toast by api */ } finally {
        this.loading = false;
      }
    }
  },
  template: `
  <div class="login-wrap">
    <section class="login-brand">
      <div class="brand-line">
        <div class="brand-mark">QJ</div>
        <div class="brand-txt">
          <div class="n">元器件供应链</div>
          <div class="s">IC SUPPLY CHAIN</div>
        </div>
      </div>

      <div class="login-hero">
        <div class="eyebrow">Inventory · BOM · Procurement</div>
        <h1>让每一颗物料<br />都清晰可追溯</h1>
        <p>从器件建档、BOM 缺料分析，到采购闭环与出入库执行，一套系统贯通电子元器件供应链的关键环节。</p>
        <ul class="login-points">
          <li><span class="dot"></span>BOM 一键比对，缺料与替代料自动计算</li>
          <li><span class="dot"></span>批次、库位、在途、预留全维度库存视图</li>
          <li><span class="dot"></span>出入库事务行锁，账实一致、全程可审计</li>
        </ul>
      </div>

      <div class="login-brand-foot">© 2026 QJCRK · 企业内网部署 · v1.0.0</div>
    </section>

    <section class="login-form-wrap">
      <div class="login-card">
        <h2>欢迎回来</h2>
        <p class="login-tip">请使用企业账号登录管理平台</p>

        <el-form label-position="top" @submit.prevent>
          <el-form-item label="登录账号">
            <el-input v-model="form.username" size="large" placeholder="请输入账号" autocomplete="username" @keyup.enter="submit">
              <template #prefix><el-icon><User /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-form-item label="登录密码">
            <el-input v-model="form.password" type="password" size="large" show-password placeholder="请输入密码" autocomplete="current-password" @keyup.enter="submit">
              <template #prefix><el-icon><Lock /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-button type="primary" class="login-btn" :loading="loading" @click="submit">
            登 录
          </el-button>
        </el-form>

        <div class="login-note">账号由超级管理员统一分配，忘记密码请联系管理员重置</div>
      </div>
    </section>
  </div>
  `
};
