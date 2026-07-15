const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /* 数据持久化 */
  loadData:        ()           => ipcRenderer.invoke('data:load'),
  saveData:        (patients)   => ipcRenderer.invoke('data:save', patients),

  /* 二维码 / 文件 */
  decodeQR:        (base64)     => ipcRenderer.invoke('qr:decode', base64),
  decodeQRZXing:   (pixelData)  => ipcRenderer.invoke('qr:decodeZXing', pixelData),
  selectImages:    ()           => ipcRenderer.invoke('file:select'),
  readClipboard:   ()           => ipcRenderer.invoke('clipboard:readImage'),

  /* 外部链接 */
  openExternal:    (url)        => ipcRenderer.invoke('shell:open', url),

  /* 全屏查看单个影像（新窗口） */
  fullscreenOpen:  (url)        => ipcRenderer.invoke('fullscreen:open', url),

  /* 多 BrowserView 管理（按病人持久化） */
  viewOpenAll:     (pid, results) => ipcRenderer.invoke('view:openAll', pid, results),
  viewShowPatient: (pid)          => ipcRenderer.invoke('view:showPatient', pid),
  viewHidePatient: (pid)          => ipcRenderer.invoke('view:hidePatient', pid),
  viewClosePatient:(pid)          => ipcRenderer.invoke('view:closePatient', pid),
  viewCloseResult: (pid, rid)     => ipcRenderer.invoke('view:closeResult', pid, rid),
  viewShowResult:  (pid, rid)     => ipcRenderer.invoke('view:showResult', pid, rid),
  viewHideResult:  (pid, rid)     => ipcRenderer.invoke('view:hideResult', pid, rid),
  viewHasViews:    (pid)          => ipcRenderer.invoke('view:hasViews', pid),
  viewSetBounds:   (items)        => ipcRenderer.invoke('view:setBounds', items),
  viewSetTop:      (pid, rid)     => ipcRenderer.invoke('view:setTop', pid, rid),
  onViewResize:    (cb)           => ipcRenderer.on('view:resize', () => cb()),

  /* 演示窗口 */
  openPresent:     (patientId)  => ipcRenderer.invoke('present:open', patientId),

  /* 接收演示数据 */
  onPresentData:   (callback)   => ipcRenderer.on('present:data', (_e, data) => callback(data))
});
