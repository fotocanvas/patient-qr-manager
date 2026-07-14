const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

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
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();   // 调试时取消注释
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
