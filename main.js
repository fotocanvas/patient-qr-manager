const { app, BrowserWindow, BrowserView, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const {
  RGBLuminanceSource,
  InvertedLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
  GlobalHistogramBinarizer,
  QRCodeReader,
  MultiFormatReader,
  DecodeHintType
} = require('@zxing/library');

// 启用 GPU 加速和 WebGL，改善 DICOM 影像在 webview 中的渲染
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const store = new Store({
  name: 'patient-data',
  defaults: { patients: [] }
});

let mainWindow = null;
let presentationWin = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: '病人影像归档管理',
    backgroundColor: '#F1F5F9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();   // 调试时取消注释

  // 窗口大小变化时更新内嵌 BrowserView 位置
  mainWindow.on('resize', notifyResize);
}

/* ── 生命周期 ─────────────────────────────────────── */
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ── 数据持久化（electron-store） ─────────────────── */
ipcMain.handle('data:load', () => {
  return store.get('patients', []);
});

ipcMain.handle('data:save', (_e, patients) => {
  store.set('patients', patients);
  return true;
});

/* ── QR 解码 ──────────────────────────────────────── */
ipcMain.handle('qr:decode', async (_e, base64) => {
  // base64 形如 "data:image/png;base64,xxxx" 或纯 base64
  const dataUrl = base64.startsWith('data:')
    ? base64
    : `data:image/png;base64,${base64}`;
  return { dataUrl };          // 返回 dataUrl 给渲染进程用 jsQR 解码
});

/* ── ZXing 原生二维码解码（主进程，比 jsQR 更强大） ──── */
ipcMain.handle('qr:decodeZXing', async (_e, { data, width, height }) => {
  try {
    // data 是来自渲染进程 canvas 的 RGBA Uint8Array
    const pixels = data instanceof Uint8Array ? data : new Uint8Array(data);

    // 转为灰度（亮度）数组
    const luminance = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      luminance[j] = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) | 0;
    }

    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);

    const readers = [new QRCodeReader(), new MultiFormatReader()];
    const binarizers = [
      (src) => new HybridBinarizer(src),
      (src) => new GlobalHistogramBinarizer(src),
    ];

    // 尝试正常亮度 + 反转亮度
    const sources = [
      new RGBLuminanceSource(luminance, width, height),
      new InvertedLuminanceSource(new RGBLuminanceSource(luminance, width, height)),
    ];

    for (const source of sources) {
      for (const makeBin of binarizers) {
        for (const reader of readers) {
          try {
            const bitmap = new BinaryBitmap(makeBin(source));
            const result = reader.decode(bitmap, hints);
            if (result && result.getText()) {
              return { ok: true, data: result.getText() };
            }
          } catch (e) {
            // NotFoundException — 继续尝试
          }
        }
      }
    }
  } catch (err) {
    console.error('ZXing decode error:', err.message);
  }
  return { ok: false, error: 'ZXing 未能解码' };
});

/* ── 文件选择 ─────────────────────────────────────── */
ipcMain.handle('file:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp'] }
    ]
  });
  if (result.canceled) return [];

  const images = [];
  for (const fp of result.filePaths) {
    try {
      const dataUrl = 'data:image/png;base64,' + fs.readFileSync(fp).toString('base64');
      images.push({ name: path.basename(fp), dataUrl });
    } catch (err) {
      console.error('读取文件失败:', fp, err.message);
    }
  }
  return images;
});

/* ── 剪贴板图片 ───────────────────────────────────── */
ipcMain.handle('clipboard:readImage', () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  const png = img.toPNG();
  if (png.length < 100) return null;   // 忽略极小图片（可能是空剪贴板）
  return 'data:image/png;base64,' + png.toString('base64');
});

/* ── 打开外部链接 ─────────────────────────────────── */
ipcMain.handle('shell:open', (_e, url) => {
  shell.openExternal(url);
});

/* ── 内置浏览器窗口（全屏查看单个影像） ───────────── */
let fullscreenWins = [];
ipcMain.handle('fullscreen:open', (_e, url) => {
  const win = new BrowserWindow({
    title: '内置浏览器 — 影像查看',
    width: 1100,
    height: 750,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#fff}
webview{width:100%;height:100%;border:none;display:block}
.hint{position:fixed;bottom:12px;right:12px;background:rgba(0,0,0,.55);color:#fff;
font:12px/1.4 "Microsoft YaHei",sans-serif;padding:6px 14px;border-radius:6px;
opacity:1;transition:opacity 2s;pointer-events:none;z-index:9}
</style></head><body>
<webview src="${url}" allowpopups webgl
  style="width:100%;height:100%"></webview>
<div class="hint" id="h">F11 全屏 · 可拖拽窗口边缘调整大小 · 关闭此标签页即关闭</div>
<script>
  // webview 启用 GPU 加速
  const wv = document.querySelector('webview');
  wv.addEventListener('dom-ready', () => {
    wv.getWebContents().enableDeviceEmulation({screenPosition:'mobile'});
    setTimeout(() => {
      wv.getWebContents().disableDeviceEmulation();
    }, 100);
  });
  setTimeout(()=>{const h=document.getElementById('h');h.style.opacity='0';setTimeout(()=>h.remove(),2000)},5000);
</script>
</body></html>
  `)}`);

  fullscreenWins.push(win);
  win.on('closed', () => {
    fullscreenWins = fullscreenWins.filter(w => w !== win);
  });
  return true;
});

/* ── 多 BrowserView 管理（按病人持久化） ────────── */
const SIDEBAR_W = 280;
const TOPBAR_H  = 48;

// viewStore: key="patientId:resultId" → { view: BrowserView, patientId, resultId }
const viewStore = new Map();

function vKey(patientId, resultId) {
  return patientId + ':' + resultId;
}

/* 打开病人所有结果的 BrowserView（仅创建+加载，不显示） */
ipcMain.handle('view:openAll', (_e, patientId, results) => {
  for (const r of results) {
    const key = vKey(patientId, r.id);
    if (!viewStore.has(key)) {
      const view = new BrowserView({
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      });
      view.webContents.loadURL(r.url);
      view.setBounds({ x: -9999, y: -9999, width: 1, height: 1 });
      viewStore.set(key, { view, patientId, resultId: r.id });
    }
  }
  return true;
});

/* 显示病人所有视图（addBrowserView） */
ipcMain.handle('view:showPatient', (_e, patientId) => {
  if (!mainWindow) return false;
  for (const [, entry] of viewStore) {
    if (entry.patientId === patientId) {
      mainWindow.addBrowserView(entry.view);
    }
  }
  return true;
});

/* 隐藏病人所有视图（removeBrowserView 但不销毁） */
ipcMain.handle('view:hidePatient', (_e, patientId) => {
  if (!mainWindow) return false;
  for (const [, entry] of viewStore) {
    if (entry.patientId === patientId) {
      mainWindow.removeBrowserView(entry.view);
    }
  }
  return true;
});

/* 关闭病人所有视图（removeBrowserView + destroy） */
ipcMain.handle('view:closePatient', (_e, patientId) => {
  const toDel = [];
  for (const [key, entry] of viewStore) {
    if (entry.patientId === patientId) {
      if (mainWindow) mainWindow.removeBrowserView(entry.view);
      try { entry.view.webContents.destroy(); } catch (_) {}
      toDel.push(key);
    }
  }
  for (const k of toDel) viewStore.delete(k);
  return true;
});

/* 关闭单个结果视图 */
ipcMain.handle('view:closeResult', (_e, patientId, resultId) => {
  const key = vKey(patientId, resultId);
  const entry = viewStore.get(key);
  if (entry) {
    if (mainWindow) mainWindow.removeBrowserView(entry.view);
    try { entry.view.webContents.destroy(); } catch (_) {}
    viewStore.delete(key);
  }
  return true;
});

/* 显示单个结果视图 */
ipcMain.handle('view:showResult', (_e, patientId, resultId) => {
  const entry = viewStore.get(vKey(patientId, resultId));
  if (entry && mainWindow) {
    mainWindow.addBrowserView(entry.view);
  }
  return true;
});

/* 隐藏单个结果视图 */
ipcMain.handle('view:hideResult', (_e, patientId, resultId) => {
  const entry = viewStore.get(vKey(patientId, resultId));
  if (entry && mainWindow) {
    mainWindow.removeBrowserView(entry.view);
  }
  return true;
});

/* 检查病人是否已有视图 */
ipcMain.handle('view:hasViews', (_e, patientId) => {
  for (const [, entry] of viewStore) {
    if (entry.patientId === patientId) return true;
  }
  return false;
});

/* 批量更新 BrowserView 位置 */
ipcMain.handle('view:setBounds', (_e, items) => {
  if (!mainWindow) return false;
  for (const b of items) {
    const entry = viewStore.get(vKey(b.patientId, b.resultId));
    if (entry) {
      const x = b.x | 0, y = b.y | 0;
      const w = Math.max(0, b.width | 0);
      const h = Math.max(0, b.height | 0);
      entry.view.setBounds({ x, y, width: w, height: h });
    }
  }
  return true;
});

/* 将指定结果视图置顶 */
ipcMain.handle('view:setTop', (_e, patientId, resultId) => {
  const entry = viewStore.get(vKey(patientId, resultId));
  if (entry && mainWindow) {
    mainWindow.setTopBrowserView(entry.view);
  }
  return true;
});

/* 窗口 resize → 通知渲染进程重新布局 */
function notifyResize() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('view:resize');
  }
}

/* ── 演示窗口 ─────────────────────────────────────── */
ipcMain.handle('present:open', (_e, patientId) => {
  const patients = store.get('patients', []);
  const patient = patients.find(p => p.id === patientId);
  if (!patient) return false;

  if (presentationWin) {
    presentationWin.close();
  }

  presentationWin = new BrowserWindow({
    title: `汇报展示 — ${patient.name}`,
    width: 1280,
    height: 800,
    backgroundColor: '#0F172A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 把病人数据暂存，等窗口加载完后通过 IPC 发送
  const patientData = JSON.stringify(patient);
  presentationWin.loadFile('present.html', {
    query: { id: patient.id }
  });

  presentationWin.once('ready-to-show', () => {
    presentationWin.webContents.send('present:data', patient);
  });

  presentationWin.on('closed', () => { presentationWin = null; });
  return true;
});
