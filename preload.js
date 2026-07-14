const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /* 数据持久化 */
  loadData:        ()           => ipcRenderer.invoke('data:load'),
  saveData:        (patients)   => ipcRenderer.invoke('data:save', patients),

  /* 二维码 / 文件 */
  decodeQR:        (base64)     => ipcRenderer.invoke('qr:decode', base64),
  selectImages:    ()           => ipcRenderer.invoke('file:select'),
  readClipboard:   ()           => ipcRenderer.invoke('clipboard:readImage'),

  /* 外部链接 */
  openExternal:    (url)        => ipcRenderer.invoke('shell:open', url),

  /* 演示窗口 */
  openPresent:     (patientId)  => ipcRenderer.invoke('present:open', patientId),

  /* 接收演示数据 */
  onPresentData:   (callback)   => ipcRenderer.on('present:data', (_e, data) => callback(data))
});
