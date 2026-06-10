const { contextBridge } = require('electron');

// Expose minimal platform info to the renderer.
// Add more ipcRenderer bridges here as needed.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});
