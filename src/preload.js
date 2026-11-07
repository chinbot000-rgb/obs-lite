const { contextBridge, ipcRenderer } = require("electron");
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);

contextBridge.exposeInMainWorld("obsLite", {
  platform: process.platform,
  listSources: call("sources:list"),
  screenPermission: call("perm:screen"),
  openFile: call("file:open"),
  writeChunk: call("file:write"),
  closeFile: call("file:close"),
  reveal: call("file:reveal"),
  minimize: call("win:minimize"),
  restore: call("win:restore"),
  onHotkey: (cb) => ipcRenderer.on("hotkey", (_e, key) => cb(key))
});
