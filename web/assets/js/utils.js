/** 通用工具 */
const Utils = (() => {
  const nf = (min, max) => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: min, maximumFractionDigits: max });

  function fmtNum(v, digits = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return nf(digits, digits).format(n);
  }
  function fmtQty(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return Number.isInteger(n) ? nf(0, 0).format(n) : nf(0, 3).format(n);
  }
  function fmtMoney(v, digits = 2) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '¥0.00';
    return '¥' + nf(digits, digits).format(n);
  }
  function fmtCompact(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + ' 万';
    return fmtQty(n);
  }
  function fmtMoneyCompact(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1e8) return '¥' + (n / 1e8).toFixed(2) + ' 亿';
    if (Math.abs(n) >= 1e4) return '¥' + (n / 1e4).toFixed(1) + ' 万';
    return fmtMoney(n);
  }
  function fmtDate(v) {
    if (!v) return '—';
    return String(v).slice(0, 10);
  }
  function fmtDateTime(v) {
    if (!v) return '—';
    return String(v).slice(0, 16).replace('T', ' ');
  }
  function fromNow(v) {
    if (!v) return '—';
    const t = new Date(String(v).replace(/-/g, '/')).getTime();
    const diff = Date.now() - t;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 30) return Math.floor(diff / 86400000) + ' 天前';
    return fmtDate(v);
  }

  const PILL = {
    // 采购申请
    draft: { text: '草稿', color: 'gray' },
    pending: { text: '待审批', color: 'amber' },
    approved: { text: '已审批', color: 'green' },
    rejected: { text: '已驳回', color: 'red' },
    ordered: { text: '已下单', color: 'blue' },
    // 采购订单
    sent: { text: '已下发', color: 'blue' },
    partial: { text: '部分到货', color: 'amber' },
    received: { text: '已完成', color: 'green' },
    cancelled: { text: '已作废', color: 'gray' },
    // 出库
    confirmed: { text: '已确认', color: 'green' },
    // 盘点
    in_progress: { text: '盘点中', color: 'amber' },
    done: { text: '已完成', color: 'green' },
    // 生命周期
    active: { text: '量产', color: 'green' },
    nrnd: { text: '不推荐', color: 'amber' },
    eol: { text: '停产', color: 'red' },
    // 匹配
    exact: { text: '精确匹配', color: 'green' },
    model_only: { text: '型号匹配', color: 'blue' },
    fuzzy: { text: '疑似匹配', color: 'amber' },
    manual: { text: '人工确认', color: 'purple' },
    unmatched: { text: '未匹配', color: 'red' },
    // 分析状态
    ok: { text: '库存充足', color: 'green' },
    shortage: { text: '缺料', color: 'red' },
    substitute: { text: '替代可补', color: 'amber' }
  };
  const pill = k => PILL[k] || { text: k || '—', color: 'gray' };

  const ORDER_TYPE = {
    purchase: '采购入库', return: '生产退料', other: '其他入库',
    production: '生产领料', borrow: '借用出库', scrap: '报废出库'
  };

  /** 导出 Excel（aoa 二维数组，第一行为表头） */
  function exportSheet(aoa, filename, sheetName = 'Sheet1') {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const widths = aoa[0].map((_, i) => {
      let max = 8;
      aoa.forEach(row => {
        const v = row[i] == null ? '' : String(row[i]);
        max = Math.max(max, Math.min(34, v.length * 1.9));
      });
      return { wch: max };
    });
    ws['!cols'] = widths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
  }

  /** 读取 Excel 首个工作表 → 对象数组 */
  function readSheet(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /** 读取 Excel 首个工作表 → 二维数组（保留空列，便于自动识别表头） */
  function readMatrix(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
          resolve(m.map(r => (r || []).map(v => String(v == null ? '' : v).trim())));
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 智能表格识别：自动定位表头行、识别列含义
   * schema: [{ key, label, type, patterns, noGuess }]
   * type: text | num | refdes | model | brand | package | unit
   */
  function smartTable(matrix, schema) {
    const maxScan = Math.min(matrix.length, 15);
    let headerRow = -1, bestScore = 0;
    for (let i = 0; i < maxScan; i++) {
      const row = matrix[i] || [];
      let score = 0;
      row.forEach(cell => {
        const t = String(cell || '').replace(/\s+/g, '');
        if (!t) return;
        if (schema.some(f => (f.patterns || []).some(p => p.test(t)))) score++;
      });
      if (score > bestScore) { bestScore = score; headerRow = i; }
    }
    if (bestScore < 2) headerRow = -1;

    const width = matrix.reduce((m, r) => Math.max(m, (r || []).length), 0);
    const headers = Array.from({ length: width }, (_, i) =>
      headerRow >= 0 ? String(matrix[headerRow][i] == null ? '' : matrix[headerRow][i]).trim() : '列' + (i + 1));
    const dataRows = matrix.slice(headerRow + 1).filter(r => r.some(v => String(v).trim() !== ''));

    const cols = headers.map((_, i) => i);
    const valsOf = i => dataRows.map(r => String(r[i] == null ? '' : r[i]).trim()).filter(Boolean);
    const used = new Set();
    const mapping = {};

    // 1) 表头文字匹配
    const byPriority = schema.filter(f => f.patterns && f.patterns.length)
      .slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const f of byPriority) {
      let best = -1, bestLen = 0;
      for (const i of cols) {
        if (used.has(i)) continue;
        const h = headers[i].replace(/\s+/g, '');
        if (!h) continue;
        if (f.patterns.some(p => p.test(h)) && h.length > bestLen) { best = i; bestLen = h.length; }
      }
      if (best >= 0) { mapping[f.key] = String(best); used.add(best); }
    }

    // 2) 内容特征兜底
    const numeric = i => {
      const v = valsOf(i);
      if (!v.length) return false;
      return v.filter(x => /^-?\d+(\.\d+)?$/.test(x.replace(/[,，]/g, ''))).length / v.length >= 0.85;
    };
    const median = i => {
      const v = valsOf(i).map(x => Number(String(x).replace(/[,，]/g, ''))).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : 0;
    };

    for (const f of schema) {
      if (f.noGuess || mapping[f.key] !== undefined) continue;
      let best = -1, score = 0;
      for (const i of cols) {
        if (used.has(i)) continue;
        const v = valsOf(i);
        if (!v.length) continue;
        let s = 0;
        if (f.type === 'refdes') {
          s = v.filter(x => /^[A-Za-z]{1,3}\d+([,，、/\-~]\s*[A-Za-z]{1,3}\d+)*$/.test(x)).length / v.length;
        } else if (f.type === 'model') {
          const ok = v.filter(x => x.length >= 4 && x.length <= 60 && /[A-Za-z]/.test(x) && /\d/.test(x) && !/^\d+$/.test(x));
          const uniq = new Set(v).size / v.length;
          s = (ok.length / v.length) * 0.8 + Math.min(uniq, 1) * 0.2;
        } else if (f.type === 'num') {
          s = numeric(i) ? 0.6 + (median(i) > 0 && median(i) <= 5000 ? 0.4 : 0) : 0;
        } else if (f.type === 'brand') {
          s = v.filter(x => x.length <= 24 && /^[A-Za-z][A-Za-z0-9 .&+\-]*$/.test(x)).length / v.length * 0.7;
        } else if (f.type === 'package') {
          s = v.filter(x => /^(0\d{3}|SOT|SOIC|SOP|QFN|LQFP|TQFP|BGA|DFN|TSSOP|MSOP|SMA|SMB|SMC|DIP|THT|SMD|PH|XH|3225|3215|5032|7060)/i.test(x)).length / v.length;
        } else if (f.type === 'unit') {
          s = v.filter(x => /^(pcs|个|只|卷|罐|盘|套|kg|m|片|颗)$/i.test(x)).length / v.length;
        } else if (f.type === 'text') {
          s = v.filter(x => /[\u4e00-\u9fa5]/.test(x)).length / v.length * 0.8;
        }
        if (s > score) { score = s; best = i; }
      }
      if (best >= 0 && score >= 0.55) { mapping[f.key] = String(best); used.add(best); }
    }

    return { headerRow, headers, dataRows, mapping };
  }

  const toNum = v => {
    const n = Number(String(v == null ? '' : v).replace(/[,，\s]/g, '').replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== '') return obj[k];
    }
    return '';
  }

  function mountChart(el, option) {
    if (!el) return null;
    const chart = echarts.init(el, null, { renderer: 'canvas' });
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    chart.__ro = ro;
    return chart;
  }
  function disposeChart(chart) {
    if (!chart) return;
    try { chart.__ro && chart.__ro.disconnect(); chart.dispose(); } catch (e) { }
  }

  const chartTheme = {
    color: ['#2563eb', '#0ea5a4', '#6366f1', '#f59e0b', '#0f766e', '#94a3b8'],
    text: '#64748b',
    split: '#f1f4f8',
    axis: '#e6eaf0'
  };

  function baseTooltip() {
    return {
      trigger: 'axis',
      backgroundColor: 'rgba(15,23,42,.94)',
      borderWidth: 0,
      padding: [8, 12],
      textStyle: { color: '#fff', fontSize: 11.5 },
      axisPointer: { type: 'line', lineStyle: { color: '#cbd5e1', type: 'dashed' } }
    };
  }

  function downloadCsv(filename, aoa) {
    const bom = '\uFEFF';
    const csv = aoa.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return {
    fmtNum, fmtQty, fmtMoney, fmtCompact, fmtMoneyCompact,
    fmtDate, fmtDateTime, fromNow,
    pill, PILL, ORDER_TYPE,
    exportSheet, readSheet, readMatrix, smartTable, toNum, downloadCsv, pick,
    mountChart, disposeChart, chartTheme, baseTooltip
  };
})();
