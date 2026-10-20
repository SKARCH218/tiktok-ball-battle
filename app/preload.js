const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("battle", {
  connect: username => ipcRenderer.invoke("tiktok:connect", username),
  disconnect: () => ipcRenderer.invoke("tiktok:disconnect"),
  onEvent: callback => ipcRenderer.on("tiktok:event", (_e, payload) => callback(payload)),
});
