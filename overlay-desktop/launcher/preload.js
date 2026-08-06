const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rxStudioLauncher', {
  getStatus: () => ipcRenderer.invoke('studio:get-status'),
  start: () => ipcRenderer.invoke('studio:start'),
  stop: () => ipcRenderer.invoke('studio:stop'),
  open: () => ipcRenderer.invoke('studio:open'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  onStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('studio:status-changed', handler);
    return () => ipcRenderer.removeListener('studio:status-changed', handler);
  },
});
