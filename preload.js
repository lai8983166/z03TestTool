const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('z03', {
  run: (name) => ipcRenderer.invoke('flow:run', name),
  stop: () => ipcRenderer.invoke('flow:stop'),
  getState: () => ipcRenderer.invoke('flow:getState'),
  onLog: (cb) => ipcRenderer.on('flow:log', (_e, data) => cb(data)),
  onStatus: (cb) => ipcRenderer.on('flow:status', (_e, data) => cb(data))
})
