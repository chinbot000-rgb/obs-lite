const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, shell, systemPreferences } = require("electron");
const path = require("path");
const fs = require("fs");

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-zero-copy");

let win, out = null, outPath = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 840, minWidth: 900, minHeight: 640,
    backgroundColor: "#111318", title: "OBS Lite", autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("sources:list", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true
    });
    return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL(), display_id: s.display_id }));
  });

  ipcMain.handle("perm:screen", () =>
    process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted");

  // Stream the recording straight to disk so long / 4K recordings never run out of memory.
  ipcMain.handle("file:open", (_e, ext) => {
    const dir = path.join(app.getPath("videos"), "OBS Lite");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    outPath = path.join(dir, `OBS-Lite-${stamp}.${ext === "mp4" ? "mp4" : "webm"}`);
    out = fs.createWriteStream(outPath);
    return outPath;
  });
  ipcMain.handle("file:write", (_e, buf) => new Promise((res, rej) => {
    if (!out) return rej(new Error("No open file"));
    out.write(Buffer.from(buf), err => (err ? rej(err) : res()));
  }));
  ipcMain.handle("file:close", () => new Promise((res, rej) => {
    if (!out) return rej(new Error("No open file"));
    const p = outPath;
    out.end(() => { out = null; res({ filePath: p, bytes: fs.statSync(p).size }); });
  }));
  ipcMain.handle("file:reveal", (_e, p) => { if (p) shell.showItemInFolder(p); });
  ipcMain.handle("win:minimize", () => win && win.minimize());
  ipcMain.handle("win:restore", () => { if (win) { win.restore(); win.show(); win.focus(); } });

  createWindow();
  globalShortcut.register("F9", () => win && win.webContents.send("hotkey", "toggle"));
  globalShortcut.register("F10", () => win && win.webContents.send("hotkey", "pause"));
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
