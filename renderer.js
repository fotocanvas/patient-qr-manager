/* ═══════════════════════════════════════════
   状态管理
   ═══════════════════════════════════════════ */
const state = {
  patients: [],
  selectedId: null,
  editingId: null,          // 编辑中的病人 id（模态框用）
  searchQuery: '',
  pendingImports: [],       // 待确认导入的结果
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
  resultsGrid:   $('#resultsGrid'),
  resultsEmpty:  $('#resultsEmpty'),
  dropOverlay:   $('#dropOverlay'),
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

function deletePatient(id) {
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
   二维码解码
   ═══════════════════════════════════════════ */
function decodeQRFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // 限制尺寸以加速解码
      const maxDim = 1200;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      try {
        const imageData = ctx.getImageData(0, 0, w, h);
        if (typeof jsQR === 'undefined') {
          resolve({ ok: false, error: 'jsQR 库未加载，请检查网络连接' });
          return;
        }
        const code = jsQR(imageData.data, w, h);
        if (code) {
          resolve({ ok: true, data: code.data });
        } else {
          resolve({ ok: false, error: '未检测到二维码' });
        }
      } catch (err) {
        resolve({ ok: false, error: '图片解码失败: ' + err.message });
      }
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

  // 显示导入模态框
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

  // 显示结果
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

  const count = patient.results.length;
  toast(`已导入 ${state.pendingImports.length || ''} 项影像结果`.replace(' 项', ` ${patient.results.filter(r => !r._counted).length} 项`), 'success');
  // 简化 toast
  toast(`导入成功！当前共 ${count} 项影像结果`, 'success');
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
    return `
      <div class="patient-item ${isActive ? 'active' : ''}" data-id="${p.id}">
        <div class="patient-avatar">${escapeHtml(initial)}</div>
        <div class="patient-item-info">
          <div class="patient-item-name">${escapeHtml(p.name)}</div>
          <div class="patient-item-meta">
            ${p.patientId ? escapeHtml(p.patientId) : '无编号'}
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

  if (count === 0) {
    dom.resultsGrid.classList.add('hidden');
    dom.resultsEmpty.classList.remove('hidden');
    $('#btnOpenAll').classList.add('hidden');
  } else {
    dom.resultsGrid.classList.remove('hidden');
    dom.resultsEmpty.classList.add('hidden');
    $('#btnOpenAll').classList.remove('hidden');

    dom.resultsGrid.innerHTML = patient.results.map((r, i) => `
      <div class="result-card" data-result-id="${r.id}">
        <div class="result-card-header">
          <div class="result-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <path d="M14 14h3v3m4-3h-3v3m-4 4h3v-3m4 0h-3v3"/>
            </svg>
          </div>
          <div class="result-card-title">
            <h4>影像结果 #${i + 1}</h4>
            <span>${formatDate(r.importedAt)}</span>
          </div>
        </div>
        <div class="result-card-body">
          <div class="result-url" title="${escapeHtml(r.url)}">${escapeHtml(r.url)}</div>
          <div class="result-card-actions">
            <button class="btn btn-outline btn-sm" onclick="openResult('${r.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              打开链接
            </button>
            <button class="btn btn-ghost btn-sm btn-danger-ghost" onclick="deleteResult('${r.id}')" title="删除">
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
}

/* ═══════════════════════════════════════════
   操作函数
   ═══════════════════════════════════════════ */
function selectPatient(id) {
  state.selectedId = id;
  renderSidebar();
  showPatientDetail();
}

function openResult(resultId) {
  const patient = getPatient(state.selectedId);
  if (!patient) return;
  const result = patient.results.find(r => r.id === resultId);
  if (result) window.api.openExternal(result.url);
}

function deleteResult(resultId) {
  const patient = getPatient(state.selectedId);
  if (!patient) return;
  patient.results = patient.results.filter(r => r.id !== resultId);
  save();
  renderPatientDetail();
  renderSidebar();
  toast('已删除该影像结果', 'success');
}

async function openAllResults() {
  const patient = getPatient(state.selectedId);
  if (!patient || patient.results.length === 0) return;

  // 间隔打开，避免浏览器拦截弹窗
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

/* ═══════════════════════════════════════════
   模态框控制
   ═══════════════════════════════════════════ */
function showModal(modal) {
  modal.classList.remove('hidden');
}

function closeModal(modal) {
  modal.classList.add('hidden');
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

  // Enter 键保存
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
    // 如果焦点在 input/textarea 中，不拦截
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (!state.selectedId) {
      toast('请先选择一个病人', 'warning');
      return;
    }

    // 尝试从剪贴板读取图片
    const dataUrl = await window.api.readClipboard();
    if (dataUrl) {
      startImport([{ name: '剪贴板图片', dataUrl }]);
    }
  });

  /* ── 键盘快捷键 ───────────────────────── */
  document.addEventListener('keydown', (e) => {
    // Ctrl+N: 添加病人
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      openAddPatientModal();
    }
    // Ctrl+I: 导入二维码
    if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      if (state.selectedId) $('#btnImportQR').click();
    }
    // Ctrl+P: 汇报展示
    if (e.ctrlKey && e.key === 'p') {
      e.preventDefault();
      if (state.selectedId) openPresentation();
    }
    // Escape: 关闭模态框
    if (e.key === 'Escape') {
      closeModal(dom.modalPatient);
      closeModal(dom.modalImport);
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
