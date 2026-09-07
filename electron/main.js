const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const BACKEND_PORT = 57843;
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;

let backendProcess = null;
let mainWindow = null;

function startBackend() {
  if (app.isPackaged) {
    const exeName = process.platform === 'win32'
      ? 'visor-dominios-backend.exe'
      : 'visor-dominios-backend';
    const exePath = path.join(process.resourcesPath, 'backend', exeName);
    backendProcess = spawn(exePath, [], { stdio: 'ignore' });
  } else {
    const script = path.join(__dirname, '..', 'backend', 'app.py');
    const venvPython = path.join(
      __dirname, '..', 'backend', '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3'
    );
    backendProcess = spawn(venvPython, [script], { stdio: 'inherit' });
  }

  backendProcess.on('error', (err) => {
    console.error('No se pudo iniciar el backend:', err);
  });
}

function waitForBackend(retries = 40, delayMs = 250) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      const req = http.get(BACKEND_HEALTH_URL, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else scheduleRetry(remaining);
      });
      req.on('error', () => scheduleRetry(remaining));
    };
    const scheduleRetry = (remaining) => {
      if (remaining <= 0) {
        reject(new Error('El backend no respondio a tiempo'));
        return;
      }
      setTimeout(() => attempt(remaining - 1), delayMs);
    };
    attempt(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function killBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    startBackend();
    try {
      await waitForBackend();
    } catch (err) {
      console.error(err);
    }
    createWindow();
  });

  app.on('before-quit', killBackend);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
