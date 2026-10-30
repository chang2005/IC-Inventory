/** 轻量 API 客户端 */
const Api = (() => {
  const BASE = '/api';
  const TOKEN_KEY = 'qjcrk_token';
  let token = localStorage.getItem(TOKEN_KEY) || '';

  const toast = (msg, type = 'error') => {
    try { ElementPlus.ElMessage({ message: msg, type, duration: 3200, showClose: true }); } catch (e) { console.warn(msg); }
  };

  function setToken(t) {
    token = t || '';
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }
  function getToken() { return token; }

  async function request(path, { method = 'GET', body, params, silent = false } = {}) {
    let url = BASE + path;
    if (params) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') qs.append(k, v);
      });
      const s = qs.toString();
      if (s) url += (url.includes('?') ? '&' : '?') + s;
    }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      if (!silent) toast('网络连接失败，请确认服务已启动');
      throw new Error('网络连接失败');
    }
    let json = {};
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) {
      const msg = json.message || `请求失败（${res.status}）`;
      if (res.status === 401) {
        setToken('');
        localStorage.removeItem('qjcrk_user');
        localStorage.removeItem('qjcrk_perms');
        if (window.Store) {
          window.Store.user = null;
          window.Store.perms = [];
        }
        if (location.hash !== '#/login') location.hash = '#/login';
      }
      if (!silent) toast(msg);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return json.data;
  }

  return {
    request, setToken, getToken,
    get: (p, params, opts) => request(p, { ...opts, params }),
    post: (p, body, opts) => request(p, { ...opts, method: 'POST', body }),
    put: (p, body, opts) => request(p, { ...opts, method: 'PUT', body }),
    del: (p, opts) => request(p, { ...opts, method: 'DELETE' }),
    toast
  };
})();
