const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rxOverlay', {
  getSettings: () => ipcRenderer.invoke('overlay:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('overlay:save-settings', settings),
  minimize: () => ipcRenderer.invoke('overlay:minimize'),
  close: () => ipcRenderer.invoke('overlay:close'),
  openExternal: (url) => ipcRenderer.invoke('overlay:open-external', url),
  notify: (payload) => ipcRenderer.invoke('overlay:notify', payload),
});
