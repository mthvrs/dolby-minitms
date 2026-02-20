// main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { fork } = require('child_process');
const Store = require('electron-store');

const store = new Store();
let mainWindow;
let serverProcess;

// 1. DEFINE PATHS
// In dev: project root. In prod: The extracted temp folder resources
const resourcesPath = app.isPackaged ? process.resourcesPath : __dirname;
const appDataPath = app.getPath('userData'); // %APPDATA%\DolbyControl

// Source files (bundled inside the exe)
const sourceConfig = path.join(resourcesPath, 'config.js'); // We will ensure this is copied in build
// Destination files (editable by user in AppData)
const destConfig = path.join(appDataPath, 'config.js');
const logsDir = path.join(appDataPath, 'logs');

async function setupEnvironment() {
    // Ensure logs directory exists
    await fs.ensureDir(logsDir);

    // If config.js doesn't exist in AppData, copy the default one from the bundle
    if (!fs.existsSync(destConfig)) {
        // Fallback for dev environment if source doesn't exist there
        const devConfig = path.join(__dirname, 'config.js');
        const src = fs.existsSync(sourceConfig) ? sourceConfig : devConfig;

        if (fs.existsSync(src)) {
            await fs.copy(src, destConfig);
            console.log('Copied default config to:', destConfig);
        }
    }
}

function startServer() {
    const serverScript = path.join(__dirname, 'server.js');

    // We pass the paths to the server via Environment Variables
    // This allows server.js to know where to read/write files
    const env = {
        ...process.env,
        ELECTRON_RUN: 'true',
        CONFIG_PATH: destConfig,
        LOGS_DIR: logsDir,
        // In Prod, mediamtx is in 'extra' folder. In Dev, it's root.
        MEDIAMTX_PATH: app.isPackaged
            ? path.join(resourcesPath, 'extra', 'mediamtx.exe')
            : path.join(__dirname, 'mediamtx.exe'),
        MEDIAMTX_CONFIG: app.isPackaged
            ? path.join(resourcesPath, 'extra', 'mediamtx.yml')
            : path.join(__dirname, 'mediamtx.yml')
    };

    serverProcess = fork(serverScript, [], { env });
}

function createWindow() {
    const windowState = store.get('windowState', { width: 1280, height: 800 });

    mainWindow = new BrowserWindow({
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        icon: path.join(__dirname, 'public/favicon.ico'), // Optional
        webPreferences: { nodeIntegration: false, contextIsolation: true },
        autoHideMenuBar: true,
        backgroundColor: '#1a1a1a',
    });

    // Load server
    // Giving the server 1s to boot. You could add a retry logic here.
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:8347');
    }, 1000);

    mainWindow.on('close', () => {
        store.set('windowState', mainWindow.getBounds());
    });
}

app.on('ready', async () => {
    await setupEnvironment();
    startServer();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
    if (serverProcess) serverProcess.kill();
});