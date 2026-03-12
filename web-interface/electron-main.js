// Electron main process for PicoClaw desktop app.
// Starts the Express API server in-process, optionally launches the PicoClaw
// gateway binary, and opens a BrowserWindow – no terminal required.

const { app, BrowserWindow, Tray, Menu, MenuItem, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const { spawn } = require('child_process');

// Force Hunspell spell-checker on Windows.
// The Windows Spell Check API (used by default on Win 8+) never populates
// dictionaryWordSuggestions in the context-menu event; Hunspell does.
if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-features', 'WindowsSpellchecker');
}

const PORT = process.env.PORT || 3000;
let mainWindow  = null;
let tray        = null;
let gatewayProc = null;

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
    const configPath = path.join(__dirname, 'picoclaw.config.json');
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return {};
    }
}

// ── Express API server (runs in-process) ──────────────────────────────────────
// api-server.js calls app.listen() at module level, so requiring it starts it.
require('./api-server');

// ── Wait for local server to be ready ────────────────────────────────────────

function waitForServer(url, maxAttempts = 40) {
    return new Promise((resolve, reject) => {
        let n = 0;
        const attempt = () => {
            http.get(url, (res) => {
                if (res.statusCode < 500) return resolve();
                retry();
            }).on('error', retry);
        };
        const retry = () => {
            if (++n >= maxAttempts) return reject(new Error('API server did not start in time'));
            setTimeout(attempt, 300);
        };
        attempt();
    });
}

// ── PicoClaw gateway binary ───────────────────────────────────────────────────

function findBinary(cfg) {
    if (cfg.binaryPath && fs.existsSync(cfg.binaryPath)) return cfg.binaryPath;

    const isWin = process.platform === 'win32';
    const name  = isWin ? 'picoclaw.exe' : 'picoclaw';

    const candidates = [
        // Packed app: binary bundled into resources/bin/
        path.join(process.resourcesPath || '', 'bin', name),
        // Dev checkout: Makefile output (plain name via symlink on Unix)
        path.join(__dirname, '..', 'build', name),
        // Dev checkout: Makefile output (platform-named, Windows has no symlink)
        path.join(__dirname, '..', 'build', isWin ? 'picoclaw-windows-amd64.exe' : `picoclaw-${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`),
        path.join(__dirname, '..', name),
    ];
    return candidates.find(p => fs.existsSync(p)) || null;
}

function startGateway() {
    const cfg    = loadConfig();
    const binary = findBinary(cfg);

    if (!binary) {
        console.warn('[picoclaw] Binary not found – start the gateway manually.');
        return;
    }

    const args = cfg.gatewayArgs    || ['gateway'];
    const cwd  = cfg.workingDir     || path.dirname(binary);
    const env  = { ...process.env, ...(cfg.env || {}) };

    console.log(`[picoclaw] Starting gateway: ${binary} ${args.join(' ')}`);
    gatewayProc = spawn(binary, args, { stdio: 'pipe', cwd, env });
    gatewayProc.stdout?.on('data', d => console.log('[gateway]', d.toString().trimEnd()));
    gatewayProc.stderr?.on('data', d => console.error('[gateway]', d.toString().trimEnd()));
    gatewayProc.on('exit', code => console.log(`[gateway] exited with code ${code}`));
}

// ── Icon helper ───────────────────────────────────────────────────────────────
// Looks for an icon packaged with the app, then falls back to the repo assets.

function resolveIcon(size) {
    const candidates = [
        path.join(__dirname, 'assets', 'icon.png'),
        path.join(__dirname, '..', 'assets', 'clawdchat-icon.png'),
        path.join(__dirname, '..', 'assets', 'logo.jpg'),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) return nativeImage.createEmpty();
    const img = nativeImage.createFromPath(found);
    return size ? img.resize({ width: size, height: size }) : img;
}

// ── BrowserWindow ─────────────────────────────────────────────────────────────

function createWindow() {
    mainWindow = new BrowserWindow({
        width:  1200,
        height: 800,
        minWidth:  640,
        minHeight: 480,
        title: 'PicoClaw',
        icon:  resolveIcon(null),
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration:  false,
            contextIsolation: true,
            spellcheck: true,
        },
        show: false,
    });

    mainWindow.removeMenu();

    mainWindow.loadURL(`http://localhost:${PORT}`);
    mainWindow.once('ready-to-show', () => mainWindow.show());

    // Lock navigation to localhost — prevent the window being hijacked to an external URL
    const allowedOrigin = `http://localhost:${PORT}`;
    mainWindow.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith(allowedOrigin)) { e.preventDefault(); }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

// Context menu: spell-check, edit actions, app controls, dev tools
        mainWindow.webContents.on('context-menu', (_event, params) => {
            const menu = new Menu();

            // Spelling suggestions (populated by Hunspell, forced above)
            if (params.misspelledWord) {
                if (params.dictionaryWordSuggestions?.length > 0) {
                    params.dictionaryWordSuggestions.forEach(s => {
                        menu.append(new MenuItem({
                            label: s,
                            click: () => mainWindow.webContents.replaceMisspelling(s),
                        }));
                    });
                } else {
                    menu.append(new MenuItem({ label: 'No suggestions', enabled: false }));
                }
                menu.append(new MenuItem({
                    label: 'Add to dictionary',
                    click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
                }));
                menu.append(new MenuItem({ type: 'separator' }));
            }

            // Standard edit actions
            if (params.isEditable) {
                menu.append(new MenuItem({ role: 'undo' }));
                menu.append(new MenuItem({ role: 'redo' }));
                menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({ role: 'cut' }));
                menu.append(new MenuItem({ role: 'copy' }));
                menu.append(new MenuItem({ role: 'paste' }));
                menu.append(new MenuItem({ role: 'selectAll' }));
            } else if (params.selectionText) {
                menu.append(new MenuItem({ role: 'copy' }));
            }

            // App controls
            if (menu.items.length > 0) menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({
                label: 'Clear Chat',
                click: () => mainWindow.webContents.executeJavaScript('window.app && window.app.clearChat()'),
            }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({
                label: 'Open Developer Tools',
                click: () => mainWindow.webContents.openDevTools(),
            }));

            menu.popup({ window: mainWindow });
    });

    // Hide instead of close on macOS so the tray icon keeps working.
    mainWindow.on('close', (e) => {
        if (process.platform === 'darwin' && !app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

// ── System tray ───────────────────────────────────────────────────────────────

function createTray() {
    const icon = resolveIcon(16);
    tray = new Tray(icon);
    tray.setToolTip('PicoClaw');

    const menu = Menu.buildFromTemplate([
        {
            label: 'Open PicoClaw',
            click: () => {
                if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
                else createWindow();
            },
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => { app.isQuitting = true; app.quit(); },
        },
    ]);

    tray.setContextMenu(menu);
    tray.on('double-click', () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
    });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    // Configure spellchecker before any window is created so the dictionary
    // is loaded and suggestions are available on first use.
    const { session } = require('electron');
    session.defaultSession.setSpellCheckerEnabled(true);
    session.defaultSession.setSpellCheckerLanguages(['en-US']);

    startGateway();
    createTray();

    try {
        await waitForServer(`http://localhost:${PORT}/api/health`);
    } catch (err) {
        console.error('[picoclaw] API server not ready:', err.message);
    }

    createWindow();

    app.on('activate', () => {
        if (!mainWindow) createWindow();
        else mainWindow.show();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    gatewayProc?.kill();
});
