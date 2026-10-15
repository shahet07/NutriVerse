const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizeChange: (cb) => {
    const listener = (_e, val) => cb(val)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },
})

contextBridge.exposeInMainWorld('desktopSystem', {
  getLanIp: () => ipcRenderer.invoke('system:get-lan-ip'),
})

contextBridge.exposeInMainWorld('desktopAuth', {
  googleSignIn: () => ipcRenderer.invoke('auth:google-sign-in'),
  openSystemBrowser: (url) => ipcRenderer.invoke('auth:open-system-browser', url),
  storeRefreshToken: (token) => ipcRenderer.invoke('auth:store-refresh-token', token),
  getRefreshToken: () => ipcRenderer.invoke('auth:get-refresh-token'),
  clearRefreshToken: () => ipcRenderer.invoke('auth:clear-refresh-token'),
  onAuthSuccess: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('on-auth-success', listener)
    return () => ipcRenderer.removeListener('on-auth-success', listener)
  },
})
