const { app, BrowserWindow, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ── Constants ────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;

// In development: electron/ lives inside model-work-frontend/, so dist/ is one level up.
// In production: dist is bundled into app.asar/resources; backend path is stored in userData.
const DIST_PATH = isDev
  ? path.resolve(__dirname, '..', 'dist')
  : path.join(process.resourcesPath, 'frontend-dist');

const CONFIG_FILE = path.join(app.getPath('userData'), 'opensight.json');

let backendProcess = null;
let mainWindow = null;

// ── Config (backend path persisted in ~/Library/Application Support/openSight/) ──

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function writeConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function getBackendDir() {
  // electron/ is inside model-work-frontend/, so backend is two levels up
if (isDev) return path.resolve(__dirname, '..', '..', 'model-work-backend');
  const cfg = readConfig();
  if (cfg.backendDir && fs.existsSync(path.join(cfg.backendDir, 'main.py'))) {
    return cfg.backendDir;
  }
  return null; // will trigger first-launch picker
}

// ── Protocol ─────────────────────────────────────────────────────────────────

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function handleAppRequest(request) {
  const urlPath = new URL(request.url).pathname;
  const resolved = path.resolve(DIST_PATH, '.' + urlPath);
  // Block path traversal
  if (!resolved.startsWith(DIST_PATH + path.sep) && resolved !== DIST_PATH) {
    return new Response('Forbidden', { status: 403 });
  }
  let target = resolved;
  try {
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      target = path.join(DIST_PATH, 'index.html');
    }
  } catch {
    target = path.join(DIST_PATH, 'index.html');
  }
  return new Response(fs.readFileSync(target), {
    headers: {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',   // \
      'Cross-Origin-Embedder-Policy': 'require-corp', // > required for SharedArrayBuffer (FFmpeg WASM)
      'Cross-Origin-Resource-Policy': 'cross-origin', // /
    },
  });
}

// ── Backend ──────────────────────────────────────────────────────────────────

function findPixi() {
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'pixi.exe' : 'pixi';
  const candidates = [
    path.join(os.homedir(), '.pixi', 'bin', bin),
    ...(isWin
      ? [path.join(process.env.LOCALAPPDATA || '', 'pixi', 'bin', bin)]
      : ['/opt/homebrew/bin/pixi', '/usr/local/bin/pixi', '/usr/bin/pixi']),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return bin; // fall back to PATH
}

function startBackend(backendDir) {
  const pixi = findPixi();
  console.log('[electron] pixi:', pixi);
  console.log('[electron] backend:', backendDir);

  backendProcess = spawn(pixi, ['run', 'start'], {
    cwd: backendDir,
    env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess.stdout.on('data', (d) => process.stdout.write('[backend] ' + d));
  backendProcess.stderr.on('data', (d) => process.stderr.write('[backend] ' + d));
  backendProcess.on('error', (err) => console.error('[electron] backend error:', err.message));
  backendProcess.on('exit', (code, sig) => {
    console.log(`[electron] backend exited code=${code} sig=${sig}`);
    backendProcess = null;
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'openSight',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL('app://localhost/');
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── First-launch setup (production only) ─────────────────────────────────────

async function pickBackendDir() {
  const result = await dialog.showOpenDialog({
    title: '选择 openSight 后端目录 (model-work-backend)',
    message: '请找到包含 main.py 的 model-work-backend 文件夹',
    properties: ['openDirectory'],
    buttonLabel: '选择此目录',
  });
  if (result.canceled || !result.filePaths.length) return null;
  const chosen = result.filePaths[0];
  if (!fs.existsSync(path.join(chosen, 'main.py'))) {
    await dialog.showMessageBox({
      type: 'error',
      message: '目录不正确',
      detail: `${chosen} 里没有找到 main.py，请重新选择 model-work-backend 目录。`,
    });
    return pickBackendDir(); // retry
  }
  return chosen;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.on('certificate-error', (event, _wc, url, _err, _cert, callback) => {
  try {
    const { hostname } = new URL(url);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch {}
  callback(false);
});

app.whenReady().then(async () => {
  protocol.handle('app', handleAppRequest);

  let backendDir = getBackendDir();

  // Production first launch: ask user to locate the backend
  if (!isDev && !backendDir) {
    backendDir = await pickBackendDir();
    if (!backendDir) {
      app.quit();
      return;
    }
    writeConfig({ ...readConfig(), backendDir });
  }

  startBackend(backendDir);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopBackend);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
