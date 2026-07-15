/* ═══════════════════════════════════════════
   状态管理
   ═══════════════════════════════════════════ */
const state = {
  patients: [],
  selectedId: null,
  editingId: null,
  searchQuery: '',
  pendingImports: [],
  openPatients: new Set(),     // 已打开 BrowserView 的病人 id 集合
  focusedResultId: null,       // 焦点模式下的 resultId（null=网格模式）
};

/* ── DOM 缓存 ───────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  patientList:   $('#patientList'),
  patientCount:  $('#patientCount'),
  searchInput:   $('#searchInput'),
  mainContent:   $('#mainContent'),
  viewWelcome:   $('#viewWelcome'),
  viewPatient:   $('#viewPatient'),
  patientName:   $('#patientName'),
  patientIdBadge:$('#patientIdBadge'),
  patientDate:   $('#patientDate'),
  resultsCount:  $('#resultsCount'),
  resultsList:   $('#resultsList'),
  resultsEmpty:  $('#resultsEmpty'),
  preloadBadge:  $('#preloadBadge'),
  dropOverlay:   $('#dropOverlay'),
  // 卡片网格
  cardGrid:      $('#cardGrid'),
  patientBody:   $('#patientBody'),
  // 焦点模式
  focusBar:       $('#focusBar'),
  focusTitle:     $('#focusTitle'),
  toastContainer:$('#toastContainer'),
  // 模态框：病人
  modalPatient:      $('#modalPatient'),
  modalPatientTitle: $('#modalPatientTitle'),
  inputName:         $('#inputPatientName'),
  inputId:           $('#inputPatientId'),
  inputNote:         $('#inputPatientNote'),
  // 模态框：导入
  modalImport:       $('#modalImport'),
  importProgress:    $('#importProgress'),
  importResults:     $('#importResults'),
  modalImportConfirm:$('#modalImportConfirm'),
};

/* ═══════════════════════════════════════════
   初始化
   ═══════════════════════════════════════════ */
(async () => {
  state.patients = await window.api.loadData();
  renderSidebar();
  bindEvents();
})();

/* ═══════════════════════════════════════════
   数据持久化
   ═══════════════════════════════════════════ */
function save() {
  return window.api.saveData(state.patients);
}

/* ═══════════════════════════════════════════
   病人 CRUD
   ═══════════════════════════════════════════ */
function addPatient(name, patientId, note) {
  const patient = {
    id: generateId(),
    name: name.trim(),
    patientId: (patientId || '').trim(),
    note: (note || '').trim(),
    createdAt: new Date().toISOString(),
    results: [],
  };
  state.patients.unshift(patient);
  save();
  return patient;
}

function updatePatient(id, data) {
  const p = state.patients.find(p => p.id === id);
  if (!p) return;
  Object.assign(p, data);
  save();
}

async function deletePatient(id) {
  // 关闭该病人的所有 BrowserView
  await window.api.viewClosePatient(id);
  state.openPatients.delete(id);

  state.patients = state.patients.filter(p => p.id !== id);
  save();
  if (state.selectedId === id) {
    state.selectedId = null;
    showWelcome();
  }
  renderSidebar();
}

function getPatient(id) {
  return state.patients.find(p => p.id === id);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ═══════════════════════════════════════════
   二维码解码（增强版：多种预处理 + 多尺度）
   ═══════════════════════════════════════════ */
function toGrayscale(imageData) {
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  return new ImageData(data, imageData.width, imageData.height);
}

function enhanceContrast(imageData, factor = 1.5) {
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const idx = i + c;
      data[idx] = Math.min(255, Math.max(0, (data[idx] - 128) * factor + 128));
    }
  }
  return new ImageData(data, imageData.width, imageData.height);
}

function applyThreshold(imageData, threshold) {
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = gray > threshold ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return new ImageData(data, imageData.width, imageData.height);
}

function invert(imageData) {
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  return new ImageData(data, imageData.width, imageData.height);
}

function getImageDataAtScale(img, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function decodeQRFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (typeof jsQR === 'undefined') {
        resolve({ ok: false, error: 'jsQR 库未加载，请检查网络连接' });
        return;
      }

      const maxDim = 1600;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const baseImageData = getImageDataAtScale(img, w, h);

      const preprocessors = [
        { name: 'original', fn: (d) => d },
        { name: 'grayscale', fn: toGrayscale },
        { name: 'contrast', fn: enhanceContrast },
        { name: 'threshold-128', fn: (d) => applyThreshold(d, 128) },
        { name: 'threshold-160', fn: (d) => applyThreshold(d, 160) },
        { name: 'threshold-inverted', fn: (d) => invert(applyThreshold(d, 128)) },
      ];

      for (const p of preprocessors) {
        try {
          const processed = p.fn(baseImageData);
          const code = jsQR(processed.data, w, h);
          if (code && code.data) {
            resolve({ ok: true, data: code.data });
            return;
          }
        } catch (err) {
          console.error(`QR decode [${p.name}] failed:`, err.message);
        }
      }

      resolve({ ok: false, error: '未检测到二维码' });
    };
    img.onerror = () => resolve({ ok: false, error: '图片加载失败' });
    img.src = dataUrl;
  });
}

/* ═══════════════════════════════════════════
   导入流程
   ═══════════════════════════════════════════ */
async function startImport(imageSources) {
  if (!state.selectedId) {
    toast('请先选择一个病人', 'warning');
    return;
  }

  showModal(dom.modalImport);
  dom.importProgress.classList.remove('hidden');
  dom.importResults.classList.add('hidden');
  dom.modalImportConfirm.classList.add('hidden');

  const patient = getPatient(state.selectedId);
  const existingUrls = new Set(patient.results.map(r => r.url));
  const results = [];

  for (const src of imageSources) {
    const decoded = await decodeQRFromDataUrl(src.dataUrl);
    if (decoded.ok) {
      const isDup = existingUrls.has(decoded.data);
      results.push({
        fileName: src.name || '剪贴板图片',
        url: decoded.data,
        status: isDup ? 'dup' : 'success',
        message: isDup ? '已存在，将跳过' : '识别成功',
      });
      if (!isDup) existingUrls.add(decoded.data);
    } else {
      results.push({
        fileName: src.name || '剪贴板图片',
        url: null,
        status: 'fail',
        message: decoded.error,
      });
    }
  }

  state.pendingImports = results.filter(r => r.status === 'success');

  dom.importProgress.classList.add('hidden');
  dom.importResults.classList.remove('hidden');
  dom.importResults.innerHTML = results.map(r => `
    <div class="import-item">
      <div class="import-item-icon ${r.status}">
        ${r.status === 'success' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>' :
          r.status === 'dup' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>' :
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'}
      </div>
      <div class="import-item-info">
        <h4>${escapeHtml(r.fileName)}</h4>
        <p>${r.url ? escapeHtml(r.url) : escapeHtml(r.message)}</p>
      </div>
      <span class="import-item-status ${r.status}">
        ${r.status === 'success' ? '成功' : r.status === 'dup' ? '重复' : '失败'}
      </span>
    </div>
  `).join('');

  if (state.pendingImports.length > 0) {
    dom.modalImportConfirm.classList.remove('hidden');
  }
}

function confirmImport() {
  const patient = getPatient(state.selectedId);
  if (!patient) return;

  const now = new Date().toISOString();
  const newCount = state.pendingImports.length;
  for (const item of state.pendingImports) {
    patient.results.push({
      id: generateId(),
      url: item.url,
      importedAt: now,
      label: '',
    });
  }

  save();
  state.pendingImports = [];
  closeModal(dom.modalImport);
  renderPatientDetail();
  renderSidebar();

  toast(`导入成功！当前共 ${patient.results.length} 项影像结果`, 'success');

  // 如果该病人已有打开的视图，为新导入的结果也创建 BrowserView
  if (state.openPatients.has(state.selectedId)) {
    const newResults = patient.results.slice(-newCount);
    window.api.viewOpenAll(state.selectedId, newResults).then(() => {
      window.api.viewShowPatient(state.selectedId);
      requestAnimationFrame(() => layoutBrowserViews());
    });
  }
}

/* ═══════════════════════════════════════════
   UI 渲染
   ═══════════════════════════════════════════ */
function renderSidebar() {
  const query = state.searchQuery.toLowerCase();
  const filtered = state.patients.filter(p => {
    if (!query) return true;
    return p.name.toLowerCase().includes(query) ||
           (p.patientId && p.patientId.toLowerCase().includes(query));
  });

  dom.patientList.innerHTML = filtered.map(p => {
    const initial = p.name.charAt(0);
    const isActive = p.id === state.selectedId;
    const count = p.results.length;
    const isOpen = state.openPatients.has(p.id);
    return `
      <div class="patient-item ${isActive ? 'active' : ''}" data-id="${p.id}">
        <div class="patient-avatar">${escapeHtml(initial)}</div>
        <div class="patient-item-info">
          <div class="patient-item-name">${escapeHtml(p.name)}</div>
          <div class="patient-item-meta">
            ${p.patientId ? escapeHtml(p.patientId) : '无编号'}
            ${isOpen ? '· 已打开' : ''}
          </div>
        </div>
        ${count > 0 ? `<span class="patient-item-badge">${count}</span>` : ''}
      </div>
    `;
  }).join('');

  if (filtered.length === 0 && query) {
    dom.patientList.innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:var(--text-muted);font-size:13px;">
        未找到匹配「${escapeHtml(state.searchQuery)}」的病人
      </div>
    `;
  }

  dom.patientCount.textContent = `共 ${state.patients.length} 位病人`;
}

function showWelcome() {
  dom.viewWelcome.classList.remove('hidden');
  dom.viewPatient.classList.add('hidden');
  // 隐藏焦点栏
  dom.focusBar.classList.add('hidden');
}

function showPatientDetail() {
  dom.viewWelcome.classList.add('hidden');
  dom.viewPatient.classList.remove('hidden');
  renderPatientDetail();
}

function renderPatientDetail() {
  const patient = getPatient(state.selectedId);
  if (!patient) { showWelcome(); return; }

  dom.patientName.textContent = patient.name;
  dom.patientIdBadge.textContent = patient.patientId || '无编号';
  dom.patientIdBadge.style.display = patient.patientId ? '' : 'none';
  dom.patientDate.textContent = '创建于 ' + formatDate(patient.createdAt);

  const count = patient.results.length;
  dom.resultsCount.textContent = `${count} 项影像结果`;

  const hasResults = count > 0;
  const isOpen = state.openPatients.has(state.selectedId);

  // 工具栏按钮
  $('#btnOpenViews').classList.toggle('hidden', !hasResults || isOpen);
  $('#btnCloseViews').classList.toggle('hidden', !isOpen);
  $('#btnOpenAll').classList.toggle('hidden', !hasResults);

  if (!hasResults) {
    dom.resultsList.innerHTML = '';
    dom.cardGrid.classList.add('hidden');
    dom.resultsEmpty.classList.remove('hidden');
    dom.focusBar.classList.add('hidden');
    return;
  }

  dom.resultsEmpty.classList.add('hidden');

  if (isOpen) {
    // 已打开影像：显示卡片网格
    renderCardGrid(patient);
    dom.resultsList.classList.add('hidden');
    dom.cardGrid.classList.remove('hidden');
    dom.cardGrid.classList.remove('focused');
    dom.focusBar.classList.add('hidden');
  } else {
    // 未打开影像：显示简单列表
    renderSimpleList(patient);
    dom.cardGrid.classList.add('hidden');
    dom.resultsList.classList.remove('hidden');
    dom.focusBar.classList.add('hidden');
  }
}

function renderSimpleList(patient) {
  dom.resultsList.innerHTML = patient.results.map((r, i) => `
    <div class="result-row" data-result-id="${r.id}">
      <div class="result-row-header">
        <span class="result-row-index">${i + 1}</span>
        <div class="result-row-info">
          <input class="result-row-title result-label-input"
                 value="${escapeHtml(r.label || `影像结果 #${i + 1}`)}"
                 onblur="updateResultLabel('${r.id}', this.value)"
                 onkeydown="if(event.key==='Enter') this.blur()"
                 title="点击修改名称">
          <div class="result-row-url">${escapeHtml(r.url)}</div>
        </div>
        <div class="result-row-actions">
          <button class="btn btn-ghost btn-icon" onclick="openResult('${r.id}')" title="在外部浏览器打开">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-danger-ghost" onclick="deleteResult('${r.id}')" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderCardGrid(patient) {
  dom.cardGrid.innerHTML = patient.results.map((r, i) => `
    <div class="card-item" data-result-id="${r.id}">
      <div class="card-header">
        <span class="card-index">${i + 1}</span>
        <input class="card-label-input"
               value="${escapeHtml(r.label || `影像结果 #${i + 1}`)}"
               onblur="updateResultLabel('${r.id}', this.value)"
               onkeydown="if(event.key==='Enter') this.blur()"
               title="点击修改名称">
        <div class="card-actions">
          <button class="btn btn-ghost btn-icon btn-sm" onclick="focusResult('${r.id}')" title="放大查看">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="fullscreenResult('${r.id}')" title="独立窗口打开">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>
            </svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm btn-danger-ghost" onclick="deleteResult('${r.id}')" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="card-content" id="card-content-${r.id}">
        <div class="card-loading">
          <div class="spinner"></div>
          <p>正在加载影像页面…</p>
        </div>
      </div>
    </div>
  `).join('');
}

/* ═══════════════════════════════════════════
   多 BrowserView 管理
   ═══════════════════════════════════════════ */
async function selectPatient(id) {
  // 隐藏当前病人的视图（不销毁）
  if (state.selectedId && state.openPatients.has(state.selectedId)) {
    await window.api.viewHidePatient(state.selectedId);
  }

  state.selectedId = id;
  state.focusedResultId = null;
  renderSidebar();
  showPatientDetail();

  // 如果新病人已有打开的视图，显示它们
  if (state.openPatients.has(id)) {
    await window.api.viewShowPatient(id);
    requestAnimationFrame(() => layoutBrowserViews());
  }
}

async function openAllViews() {
  const patient = getPatient(state.selectedId);
  if (!patient || patient.results.length === 0) return;

  toast(`正在打开 ${patient.results.length} 个影像页面…`, 'info');

  // 创建所有 BrowserView（加载 URL）
  await window.api.viewOpenAll(state.selectedId, patient.results);

  // 显示所有视图
  await window.api.viewShowPatient(state.selectedId);

  state.openPatients.add(state.selectedId);
  renderSidebar();

  // 渲染卡片网格
  renderPatientDetail();

  // 等待 DOM 渲染后布局 BrowserView
  requestAnimationFrame(() => layoutBrowserViews());

  toast(`已打开 ${patient.results.length} 个影像页面`, 'success');
}

async function closeAllViews() {
  if (!state.selectedId) return;
  await window.api.viewClosePatient(state.selectedId);
  state.openPatients.delete(state.selectedId);
  state.focusedResultId = null;
  renderSidebar();
  renderPatientDetail();
  toast('已关闭全部影像页面', 'info');
}

function layoutBrowserViews() {
  if (!state.selectedId || !state.openPatients.has(state.selectedId)) return;

  // 焦点模式：只布局一个全屏视图
  if (state.focusedResultId) {
    layoutFocusedView();
    return;
  }

  const patient = getPatient(state.selectedId);
  if (!patient) return;

  const items = [];
  for (const r of patient.results) {
    const el = document.getElementById(`card-content-${r.id}`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    items.push({
      patientId: state.selectedId,
      resultId: r.id,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }
  if (items.length > 0) {
    window.api.viewSetBounds(items);
  }
}

function layoutFocusedView() {
  if (!state.focusedResultId) return;
  const patient = getPatient(state.selectedId);
  if (!patient) return;

  // 焦点视图占据卡片网格区域（卡片网格已隐藏，但位置仍可计算）
  // 使用焦点栏下方的整个区域
  const focusBar = dom.focusBar;
  const focusBarRect = focusBar.getBoundingClientRect();
  const mainRect = dom.mainContent.getBoundingClientRect();

  const x = mainRect.left;
  const y = focusBarRect.bottom;
  const w = mainRect.width;
  const h = mainRect.height - (focusBarRect.bottom - mainRect.top);

  window.api.viewSetBounds([{
    patientId: state.selectedId,
    resultId: state.focusedResultId,
    x: x,
    y: y,
    width: Math.max(0, w),
    height: Math.max(0, h),
  }]);
}

async function focusResult(resultId) {
  const patient = getPatient(state.selectedId);
  if (!patient) return;
  const result = patient.results.find(r => r.id === resultId);
  if (!result) return;

  // 隐藏所有视图，只显示焦点视图
  await window.api.viewHidePatient(state.selectedId);
  await window.api.viewShowResult(state.selectedId, resultId);

  state.focusedResultId = resultId;

  // 更新 UI
  dom.cardGrid.classList.add('focused');
  dom.resultsList.classList.add('hidden');
  dom.focusBar.classList.remove('hidden');
  const resultIndex = patient.results.indexOf(result) + 1;
  const resultLabel = result.label || `影像结果 #${resultIndex}`;
  dom.focusTitle.textContent = `${patient.name} — ${resultLabel}`;
  $('#btnFocusFullscreen').onclick = () => window.api.openExternal(result.url);

  requestAnimationFrame(() => layoutFocusedView());
}

async function unfocusResult() {
  // 恢复所有视图
  await window.api.viewShowPatient(state.selectedId);

  state.focusedResultId = null;
  dom.cardGrid.classList.remove('focused');
  dom.focusBar.classList.add('hidden');

  requestAnimationFrame(() => layoutBrowserViews());
}

/* ═══════════════════════════════════════════
   操作函数
   ═══════════════════════════════════════════ */
function openResult(resultId) {
  const patient = getPatient(state.selectedId);
  if (!patient) return;
  const result = patient.results.find(r => r.id === resultId);
  if (result) window.api.openExternal(result.url);
}

function fullscreenResult(resultId) {
  const patient = getPatient(state.selectedId);
  if (!patient) return;
  const result = patient.results.find(r => r.id === resultId);
  if (result) window.api.fullscreenOpen(result.url);
}

function updateResultLabel(resultId, label) {
  const patient = getPatient(state.selectedId);
  if (!patient) return;
  const result = patient.results.find(r => r.id === resultId);
  if (!result) return;

  const trimmed = label.trim();
  const newLabel = trimmed || '';
  if (result.label === newLabel) return;

  result.label = newLabel;
  save();

  // 同步更新焦点栏标题
  if (state.focusedResultId === resultId && dom.focusBar) {
    const idx = patient.results.indexOf(result) + 1;
    dom.focusTitle.textContent = `${patient.name} — ${result.label || `影像结果 #${idx}`}`;
  }

  toast('名称已保存', 'success');
}

async function deleteResult(resultId) {
  const patient = getPatient(state.selectedId);
  if (!patient) return;

  // 如果焦点模式正在查看该结果，先退出
  if (state.focusedResultId === resultId) {
    await unfocusResult();
  }

  // 关闭该结果的 BrowserView
  await window.api.viewCloseResult(state.selectedId, resultId);

  patient.results = patient.results.filter(r => r.id !== resultId);
  save();
  renderPatientDetail();
  renderSidebar();

  // 重新布局剩余的 BrowserView
  if (state.openPatients.has(state.selectedId)) {
    requestAnimationFrame(() => layoutBrowserViews());
  }

  toast('已删除该影像结果', 'success');
}

async function openAllResults() {
  const patient = getPatient(state.selectedId);
  if (!patient || patient.results.length === 0) return;

  for (let i = 0; i < patient.results.length; i++) {
    setTimeout(() => {
      window.api.openExternal(patient.results[i].url);
    }, i * 300);
  }
  toast(`正在打开 ${patient.results.length} 个链接…`, 'success');
}

function openPresentation() {
  if (!state.selectedId) return;
  const patient = getPatient(state.selectedId);
  if (!patient || patient.results.length === 0) {
    toast('该病人暂无影像结果', 'warning');
    return;
  }
  window.api.openPresent(state.selectedId);
}

/* ── 模态框控制 ──────────────────────────────────── */
let modalCount = 0;
let viewsHiddenByModal = false;

function showModal(modal) {
  modal.classList.remove('hidden');
  modalCount++;
  if (modalCount === 1 && state.selectedId && state.openPatients.has(state.selectedId)) {
    window.api.viewHidePatient(state.selectedId).catch(() => {});
    viewsHiddenByModal = true;
  }
}

function closeModal(modal) {
  modal.classList.add('hidden');
  modalCount--;
  if (modalCount === 0 && viewsHiddenByModal && state.selectedId && state.openPatients.has(state.selectedId)) {
    window.api.viewShowPatient(state.selectedId).then(() => {
      requestAnimationFrame(() => layoutBrowserViews());
    }).catch(() => {});
    viewsHiddenByModal = false;
  }
}

function openAddPatientModal() {
  state.editingId = null;
  dom.modalPatientTitle.textContent = '添加病人';
  dom.inputName.value = '';
  dom.inputId.value = '';
  dom.inputNote.value = '';
  showModal(dom.modalPatient);
  setTimeout(() => dom.inputName.focus(), 100);
}

function openEditPatientModal() {
  const patient = getPatient(state.selectedId);
  if (!patient) return;
  state.editingId = patient.id;
  dom.modalPatientTitle.textContent = '编辑病人信息';
  dom.inputName.value = patient.name;
  dom.inputId.value = patient.patientId || '';
  dom.inputNote.value = patient.note || '';
  showModal(dom.modalPatient);
  setTimeout(() => dom.inputName.focus(), 100);
}

function savePatientModal() {
  const name = dom.inputName.value.trim();
  if (!name) {
    toast('请输入病人姓名', 'warning');
    dom.inputName.focus();
    return;
  }

  const patientId = dom.inputId.value.trim();
  const note = dom.inputNote.value.trim();

  if (state.editingId) {
    updatePatient(state.editingId, { name, patientId, note });
    toast('病人信息已更新', 'success');
  } else {
    const patient = addPatient(name, patientId, note);
    state.selectedId = patient.id;
    toast(`已添加病人「${name}」`, 'success');
  }

  closeModal(dom.modalPatient);
  renderSidebar();
  if (state.selectedId) showPatientDetail();
}

/* ═══════════════════════════════════════════
   Toast 通知
   ═══════════════════════════════════════════ */
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

/* ═══════════════════════════════════════════
   工具函数
   ═══════════════════════════════════════════ */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ═══════════════════════════════════════════
   事件绑定
   ═══════════════════════════════════════════ */
function bindEvents() {
  /* ── 侧边栏：点击病人 ─────────────────── */
  dom.patientList.addEventListener('click', (e) => {
    const item = e.target.closest('.patient-item');
    if (item) selectPatient(item.dataset.id);
  });

  /* ── 搜索 ─────────────────────────────── */
  dom.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderSidebar();
  });

  /* ── 添加病人按钮 ─────────────────────── */
  $('#btnAddPatient').addEventListener('click', openAddPatientModal);
  $('#btnWelcomeAdd').addEventListener('click', openAddPatientModal);

  /* ── 模态框：病人 ─────────────────────── */
  $('#modalPatientClose').addEventListener('click', () => closeModal(dom.modalPatient));
  $('#modalPatientCancel').addEventListener('click', () => closeModal(dom.modalPatient));
  $('#modalPatientSave').addEventListener('click', savePatientModal);
  dom.modalPatient.addEventListener('click', (e) => {
    if (e.target === dom.modalPatient) closeModal(dom.modalPatient);
  });

  dom.inputName.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePatientModal(); });
  dom.inputId.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePatientModal(); });

  /* ── 病人详情操作 ─────────────────────── */
  $('#btnEditPatient').addEventListener('click', openEditPatientModal);
  $('#btnDeletePatient').addEventListener('click', () => {
    const patient = getPatient(state.selectedId);
    if (!patient) return;
    if (confirm(`确定要删除病人「${patient.name}」及其所有影像结果吗？\n此操作不可撤销。`)) {
      deletePatient(patient.id);
      toast('已删除', 'success');
    }
  });

  /* ── 导入二维码 ──────────────────────── */
  $('#btnImportQR').addEventListener('click', async () => {
    const images = await window.api.selectImages();
    if (images.length === 0) return;
    startImport(images);
  });

  /* ── 模态框：导入 ─────────────────────── */
  $('#modalImportClose').addEventListener('click', () => closeModal(dom.modalImport));
  $('#modalImportCancel').addEventListener('click', () => closeModal(dom.modalImport));
  dom.modalImport.addEventListener('click', (e) => {
    if (e.target === dom.modalImport) closeModal(dom.modalImport);
  });
  dom.modalImportConfirm.addEventListener('click', confirmImport);

  /* ── 汇报展示 ─────────────────────────── */
  $('#btnPresent').addEventListener('click', openPresentation);
  $('#btnOpenAll').addEventListener('click', openAllResults);
  $('#btnOpenViews').addEventListener('click', openAllViews);
  $('#btnCloseViews').addEventListener('click', closeAllViews);

  /* ── 焦点模式 ─────────────────────────── */
  $('#btnFocusBack').addEventListener('click', unfocusResult);

  /* ── BrowserView 布局同步 ─────────────── */
  // 滚动时重新计算 BrowserView 位置（节流）
  let scrollTimer = null;
  dom.patientBody.addEventListener('scroll', () => {
    if (scrollTimer) return;
    scrollTimer = requestAnimationFrame(() => {
      layoutBrowserViews();
      scrollTimer = null;
    });
  });

  // 窗口 resize 时重新布局
  window.api.onViewResize(() => {
    requestAnimationFrame(() => layoutBrowserViews());
  });

  /* ── 拖拽导入 ─────────────────────────── */
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer.types.includes('Files')) {
      dom.dropOverlay.classList.remove('hidden');
    }
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dom.dropOverlay.classList.add('hidden');
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dom.dropOverlay.classList.add('hidden');

    if (!state.selectedId) {
      toast('请先选择一个病人', 'warning');
      return;
    }

    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const images = [];
    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      images.push({ name: file.name, dataUrl });
    }
    startImport(images);
  });

  /* ── 剪贴板粘贴 ───────────────────────── */
  document.addEventListener('paste', async (e) => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (!state.selectedId) {
      toast('请先选择一个病人', 'warning');
      return;
    }

    const dataUrl = await window.api.readClipboard();
    if (dataUrl) {
      startImport([{ name: '剪贴板图片', dataUrl }]);
    }
  });

  /* ── 键盘快捷键 ───────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      openAddPatientModal();
    }
    if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      if (state.selectedId) $('#btnImportQR').click();
    }
    if (e.ctrlKey && e.key === 'p') {
      e.preventDefault();
      if (state.selectedId) openPresentation();
    }
    if (e.key === 'Escape') {
      closeModal(dom.modalPatient);
      closeModal(dom.modalImport);
      if (state.focusedResultId) unfocusResult();
    }
  });
}

/* ── 文件转 DataURL ─────────────────────── */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
