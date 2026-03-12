// Simple API server for PicoClaw web interface
// This acts as a bridge between the web interface and PicoClaw gateway

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const crypto  = require('crypto');
const { spawnSync, spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const GATEWAY_WEB_CHANNEL_URL = process.env.PICOCLAW_WEB_CHANNEL_URL || 'http://localhost:18790';

// ── Whisper STT detection ─────────────────────────────────────────────────────
// Returns { type: 'python'|'cli', cmd: string } or null.
// 'python' uses stt.py (faster-whisper library, ~4x faster).
// 'cli'    uses the openai-whisper command-line tool as fallback.

function findSttEngine() {
    // 1. Prefer Python + stt.py (uses faster-whisper library if installed)
    const pyCmds = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    const sttScript = path.join(__dirname, 'stt.py');
    if (fs.existsSync(sttScript)) {
        for (const pyCmd of pyCmds) {
            const r = spawnSync(pyCmd, ['-c', 'import faster_whisper'], { timeout: 5000 });
            if (r.status === 0) return { type: 'python', cmd: pyCmd };
        }
        // faster-whisper not available — try openai-whisper via Python
        for (const pyCmd of pyCmds) {
            const r = spawnSync(pyCmd, ['-c', 'import whisper'], { timeout: 5000 });
            if (r.status === 0) return { type: 'python', cmd: pyCmd };
        }
    }
    // 2. Fall back to whisper CLI
    const findCmd = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(findCmd, ['whisper'], { timeout: 3000, encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return { type: 'cli', cmd: r.stdout.trim().split(/\r?\n/)[0] };
    // 3. Check bundled build path
    const name = process.platform === 'win32' ? 'whisper.exe' : 'whisper';
    const devPath = path.join(__dirname, '..', 'build', name);
    if (fs.existsSync(devPath)) return { type: 'cli', cmd: devPath };
    const resPath = path.join(process.resourcesPath || '', 'bin', name);
    if (fs.existsSync(resPath)) return { type: 'cli', cmd: resPath };
    return null;
}
const sttEngine = findSttEngine();
const whisperBin = sttEngine?.cmd || null; // kept for backwards-compat (capabilities check)
console.log(sttEngine
    ? `[stt] Engine found: ${sttEngine.type} → ${sttEngine.cmd}`
    : '[stt] No STT engine found – voice input disabled');

// Only accept requests from the local interface
const ALLOWED_ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
app.use(cors({
    origin: (origin, cb) => {
        // Allow same-origin (Electron / curl) and explicit localhost origins
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error('CORS: origin not allowed'));
    }
}));
app.use(express.json({ limit: '64kb', type: 'application/json' }));

// Serve static files (CSS, JS, etc.) with proper charset
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=UTF-8');
        }
    }
}));

// Check if PicoClaw web channel is running
async function checkGateway() {
    try {
        const response = await fetch(`${GATEWAY_WEB_CHANNEL_URL}/health`);
        return response.ok;
    } catch {
        return false;
    }
}

// Routes
app.get('/api/status', async (req, res) => {
    const gatewayRunning = await checkGateway();
    res.json({
        gateway: {
            running: gatewayRunning,
            url: GATEWAY_WEB_CHANNEL_URL
        },
        webInterface: {
            running: true,
            url: `http://localhost:${PORT}`
        }
    });
});

app.post('/api/chat', async (req, res) => {
    const { message, chat_id = 'web-interface' } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        const upstream = await fetch(`${GATEWAY_WEB_CHANNEL_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, chat_id }),
            signal: AbortSignal.timeout(125000)
        });

        const data = await upstream.json();
        res.status(upstream.status).json(data);
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return res.status(504).json({ error: 'Gateway timed out' });
        }
        res.status(503).json({
            error: 'PicoClaw web channel not reachable',
            suggestion: 'Enable the web channel in your PicoClaw config: set channels.web.enabled = true'
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/capabilities', (req, res) => {
    res.json({ whisper: !!whisperBin });
});

app.get('/api/config', (req, res) => {
    const configPath = path.join(os.homedir(), '.picoclaw', 'config.json');
    try {
        if (!fs.existsSync(configPath)) {
            return res.status(404).json({ 
                error: 'Configuration file not found',
                path: configPath,
                suggestion: 'Run: .\\build\\picoclaw.exe onboard'
            });
        }
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);
        
        // Return unmasked config for editing if requested
        if (req.query.raw === 'true') {
            return res.json({ 
                config,
                path: configPath,
                lastModified: fs.statSync(configPath).mtime
            });
        }
        
        // Mask sensitive fields (API keys)
        if (config.providers) {
            for (const provider in config.providers) {
                if (config.providers[provider].api_key) {
                    const key = config.providers[provider].api_key;
                    config.providers[provider].api_key = key ? key.substring(0, 8) + '...' : '';
                }
            }
        }
        
        res.json({ 
            config,
            path: configPath,
            lastModified: fs.statSync(configPath).mtime
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to read config file',
            message: error.message
        });
    }
});

app.post('/api/config', (req, res) => {
    const configPath = path.join(os.homedir(), '.picoclaw', 'config.json');
    try {
        const { config } = req.body;
        
        if (!config) {
            return res.status(400).json({ error: 'Config data is required' });
        }
        
        // Validate JSON structure
        if (typeof config !== 'object') {
            return res.status(400).json({ error: 'Config must be a valid JSON object' });
        }
        
        // Create backup before saving
        if (fs.existsSync(configPath)) {
            const backupPath = `${configPath}.backup`;
            fs.copyFileSync(configPath, backupPath);
        }
        
        // Write new config
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
        
        res.json({ 
            success: true,
            message: 'Configuration saved successfully',
            lastModified: fs.statSync(configPath).mtime
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to save config file',
            message: error.message
        });
    }
});

// ── Speech-to-text (Whisper) ──────────────────────────────────────────────────

app.post('/api/stt', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
    if (!sttEngine)          return res.status(503).json({ error: 'No STT engine installed' });
    if (!req.body?.length)   return res.status(400).json({ error: 'No audio data received' });

    const ext      = /^(ogg|webm|mp3|wav|m4a)$/.test(req.query.ext) ? req.query.ext : 'webm';
    const tmpId    = crypto.randomBytes(8).toString('hex');
    const tmpAudio = path.join(os.tmpdir(), `picoclaw_stt_${tmpId}.${ext}`);
    const txtFile  = path.join(os.tmpdir(), `picoclaw_stt_${tmpId}.txt`);

    try {
        fs.writeFileSync(tmpAudio, req.body);

        const transcript = await new Promise((resolve, reject) => {
            let proc;
            if (sttEngine.type === 'python') {
                // faster-whisper (or openai-whisper) via stt.py — result comes from stdout
                proc = spawn(sttEngine.cmd, [path.join(__dirname, 'stt.py'), tmpAudio]);
            } else {
                // openai-whisper CLI — writes a .txt file alongside the audio
                proc = spawn(sttEngine.cmd, [
                    tmpAudio,
                    '--output_format', 'txt',
                    '--output_dir', os.tmpdir(),
                    '--model', 'tiny',
                ]);
            }
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', d => { stdout += d; });
            proc.stderr?.on('data', d => { stderr += d; });
            proc.on('close', code => {
                if (code !== 0) {
                    console.error('[stt] Engine error:', stderr.slice(0, 400));
                    return reject(new Error(`STT exited ${code}: ${stderr.slice(0, 200)}`));
                }
                if (sttEngine.type === 'python') {
                    // stt.py prints the transcript directly to stdout
                    return resolve(stdout.trim());
                }
                // CLI: prefer reading the output .txt file; fall back to stdout
                try {
                    const txt = fs.readFileSync(txtFile, 'utf8').trim();
                    if (txt) return resolve(txt);
                } catch {}
                const fromStdout = stdout.replace(/\[\d+:\d+\.\d+ --> \d+:\d+\.\d+\]\s*/g, '').trim();
                resolve(fromStdout);
            });
            proc.on('error', err => {
                console.error('[stt] Spawn error:', err.message);
                reject(err);
            });
        });

        res.json({ transcript });
    } catch (err) {
        res.status(500).json({ error: 'Transcription failed: ' + err.message });
    } finally {
        try { fs.unlinkSync(tmpAudio); } catch {}
        try { fs.unlinkSync(txtFile);  } catch {}
    }
});

// Serve the main interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`PicoClaw Web Interface server running on http://localhost:${PORT}`);
    console.log(`Open your browser to: http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop the server');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
});