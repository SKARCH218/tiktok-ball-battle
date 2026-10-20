const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const { chatEvent, socialEvent, createGiftHandler } = require("./gifts");

const RETRY_MS = 20000;

let win = null;

function send(payload) {
  if (win && !win.isDestroyed()) win.webContents.send("tiktok:event", payload);
}

function status(state, text) {
  send({ type: "status", state, text });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 450,
    height: 800,
    minWidth: 300,
    minHeight: 533,
    useContentSize: true,
    backgroundColor: "#05070d",
    title: "Ball Battle",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAspectRatio(9 / 16);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("closed", () => { win = null; });
}

// ---------------------------------------------------------------- TikTok connection
let libPromise = null;
const loadLib = () => (libPromise ||= import("tiktok-live-connector"));

let generation = 0;          // bumped on every connect/disconnect so stale loops stop
let connection = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const gifts = createGiftHandler();

async function runConnection(username, myGeneration) {
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await loadLib();
  const uniqueId = username.startsWith("@") ? username : `@${username}`;

  while (myGeneration === generation) {
    const conn = new TikTokLiveConnection(uniqueId, {});
    connection = conn;

    conn.on(WebcastEvent.CHAT, data => {
      const ev = chatEvent(data);
      if (ev) send(ev);
    });
    for (const [event, kind] of [[WebcastEvent.LIKE, "like"], [WebcastEvent.FOLLOW, "follow"]]) {
      conn.on(event, data => {
        const ev = socialEvent(kind, data);
        if (ev) send(ev);
      });
    }
    conn.on(WebcastEvent.GIFT, data => {
      const ev = gifts.handle(data);
      if (ev) send(ev);
    });

    const closed = new Promise(resolve => {
      conn.on(ControlEvent.DISCONNECTED, resolve);
      conn.on(WebcastEvent.STREAM_END, resolve);
    });

    try {
      status("connecting", `Connecting to ${uniqueId}...`);
      await conn.connect();
      status("connected", `Connected to ${uniqueId}`);
      await closed;
      if (myGeneration !== generation) break;
      status("error", `Disconnected. Retrying in ${RETRY_MS / 1000}s...`);
    } catch (err) {
      if (myGeneration !== generation) break;
      const msg = String((err && (err.message || err.info)) || err);
      const offline = /offline|not.*live|LIVE has ended|isn't online/i.test(msg);
      status(offline ? "offline" : "error",
        offline ? `${uniqueId} is not live right now. Retrying in ${RETRY_MS / 1000}s...`
                : `Error: ${msg.slice(0, 60)}. Retrying in ${RETRY_MS / 1000}s...`);
    } finally {
      try { conn.disconnect(); } catch (e) { /* already closed */ }
    }

    // wait before retrying, but wake up immediately if the user stopped/restarted
    for (let waited = 0; waited < RETRY_MS && myGeneration === generation; waited += 500) await sleep(500);
  }
}

ipcMain.handle("tiktok:connect", (_event, username) => {
  const name = String(username || "").trim();
  if (!name) return false;
  generation += 1;
  gifts.clear();
  runConnection(name, generation).catch(err => status("error", `Error: ${String(err.message || err).slice(0, 60)}`));
  return true;
});

ipcMain.handle("tiktok:disconnect", () => {
  generation += 1;
  gifts.clear();
  try { if (connection) connection.disconnect(); } catch (e) { /* already closed */ }
  connection = null;
  return true;
});

// ---------------------------------------------------------------- app lifecycle
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
