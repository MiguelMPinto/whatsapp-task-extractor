'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UI_DIR = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const LOGS_DIR = path.join(ROOT, 'logs');
const TODO_FILE = path.join(DATA_DIR, 'todo.json');
const ESTADO_FILE = path.join(DATA_DIR, 'estado.json');
const ESTADO_TMP = path.join(DATA_DIR, 'estado.json.tmp');
const SERVER_LOG = path.join(LOGS_DIR, 'server.log');
const UI_LOG = path.join(LOGS_DIR, 'ui.log');
const LOCK_FILE = path.join(DATA_DIR, '.lock');
const RUN_NOW_BAT = path.join(ROOT, 'run-now.bat');
const LOCK_FRESH_MS = 10 * 60 * 1000;

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_BODY_ESTADO = 1 * 1024 * 1024;
const MAX_BODY_LOGS = 64 * 1024;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.txt': 'text/plain; charset=utf-8'
};

function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

function logServer(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { fs.appendFileSync(SERVER_LOG, line); } catch (_) {}
}

function send(res, status, body, headers) {
    headers = headers || {};
    try {
        res.writeHead(status, headers);
        if (body !== undefined && body !== null) res.end(body);
        else res.end();
    } catch (_) {}
}

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    send(res, status, body, { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, max) {
    return new Promise((resolve, reject) => {
        let total = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > max) {
                req.destroy();
                reject(new Error('body demasiado grande'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function safeStaticPath(urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath.split('?')[0]); }
    catch (_) { return null; }
    const candidate = path.normalize(path.join(UI_DIR, decoded));
    if (candidate !== UI_DIR && !candidate.startsWith(UI_DIR + path.sep)) return null;
    return candidate;
}

function handleStatic(req, res, urlPath) {
    let filePath;
    if (urlPath === '/' || urlPath === '') {
        filePath = path.join(UI_DIR, 'index.html');
    } else {
        filePath = safeStaticPath(urlPath);
        if (!filePath) {
            send(res, 404, 'Not Found');
            return;
        }
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            send(res, 404, 'Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const ct = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => { try { res.destroy(); } catch (_) {} });
        stream.pipe(res);
    });
}

function handleGetTodos(req, res) {
    fs.readFile(TODO_FILE, 'utf8', (err, raw) => {
        if (err && err.code === 'ENOENT') {
            sendJson(res, 200, []);
            return;
        }
        if (err) {
            logServer(`erro a ler todo.json: ${err.message}`);
            sendJson(res, 500, { error: 'falha a ler todo.json' });
            return;
        }
        if (!raw || !raw.trim()) {
            sendJson(res, 200, []);
            return;
        }
        try {
            sendJson(res, 200, JSON.parse(raw));
        } catch (e) {
            logServer(`todo.json malformado: ${e.message}`);
            sendJson(res, 500, { error: 'todo.json malformado' });
        }
    });
}

function handleGetEstado(req, res) {
    fs.readFile(ESTADO_FILE, 'utf8', (err, raw) => {
        if (err && err.code === 'ENOENT') {
            sendJson(res, 200, {});
            return;
        }
        if (err) {
            logServer(`erro a ler estado.json: ${err.message}`);
            sendJson(res, 500, { error: 'falha a ler estado.json' });
            return;
        }
        if (!raw || !raw.trim()) {
            sendJson(res, 200, {});
            return;
        }
        try {
            sendJson(res, 200, JSON.parse(raw));
        } catch (e) {
            logServer(`estado.json malformado: ${e.message}`);
            sendJson(res, 500, { error: 'estado.json malformado' });
        }
    });
}

async function handlePostEstado(req, res) {
    let body;
    try {
        body = await readBody(req, MAX_BODY_ESTADO);
    } catch (e) {
        sendJson(res, 413, { error: 'body demasiado grande' });
        return;
    }
    let obj;
    try {
        obj = JSON.parse(body.toString('utf8'));
    } catch (e) {
        sendJson(res, 400, { error: 'JSON invalido' });
        return;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        sendJson(res, 400, { error: 'estado tem de ser objecto' });
        return;
    }
    ensureDir(DATA_DIR);
    const text = JSON.stringify(obj, null, 2);
    fs.writeFile(ESTADO_TMP, text, 'utf8', (err) => {
        if (err) {
            logServer(`erro a escrever estado.json.tmp: ${err.message}`);
            sendJson(res, 500, { error: 'falha a escrever estado' });
            return;
        }
        fs.rename(ESTADO_TMP, ESTADO_FILE, (err2) => {
            if (err2) {
                logServer(`erro a promover estado.json: ${err2.message}`);
                sendJson(res, 500, { error: 'falha a promover estado' });
                return;
            }
            send(res, 204);
        });
    });
}

function lockIsFresh() {
    try {
        const st = fs.statSync(LOCK_FILE);
        return (Date.now() - st.mtimeMs) < LOCK_FRESH_MS;
    } catch (_) {
        return false;
    }
}

function handlePostRefresh(req, res) {
    if (lockIsFresh()) {
        logServer('/api/refresh: rejeitado (lock fresco)');
        sendJson(res, 409, { error: 'pipeline ja em execucao' });
        return;
    }
    try {
        const child = spawn('cmd.exe', ['/c', RUN_NOW_BAT, '--no-pause'], {
            cwd: ROOT,
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
        const startedAt = new Date().toISOString();
        logServer(`/api/refresh: spawned run-now.bat (pid=${child.pid}) at ${startedAt}`);
        sendJson(res, 202, { ok: true, started: startedAt });
    } catch (e) {
        logServer(`/api/refresh: spawn falhou: ${(e && e.message) || e}`);
        sendJson(res, 500, { error: 'falha a arrancar pipeline' });
    }
}

async function handlePostLogs(req, res) {
    let body;
    try {
        body = await readBody(req, MAX_BODY_LOGS);
    } catch (e) {
        sendJson(res, 413, { error: 'body demasiado grande' });
        return;
    }
    let obj;
    try {
        obj = JSON.parse(body.toString('utf8'));
    } catch (e) {
        sendJson(res, 400, { error: 'JSON invalido' });
        return;
    }
    const level = (obj && typeof obj.level === 'string') ? obj.level : 'info';
    const msg = (obj && typeof obj.msg === 'string') ? obj.msg : '';
    const stack = (obj && typeof obj.stack === 'string') ? obj.stack : '';
    const line = `[${new Date().toISOString()}] [${level}] ${msg}${stack ? '\n' + stack : ''}\n`;
    ensureDir(LOGS_DIR);
    fs.appendFile(UI_LOG, line, (err) => {
        if (err) {
            logServer(`erro a escrever ui.log: ${err.message}`);
            sendJson(res, 500, { error: 'falha a escrever log' });
            return;
        }
        send(res, 204);
    });
}

const ROUTES = {
    'GET /api/todos': handleGetTodos,
    'GET /api/estado': handleGetEstado,
    'POST /api/estado': handlePostEstado,
    'POST /api/refresh': handlePostRefresh,
    'POST /api/logs': handlePostLogs
};

function dispatch(req, res) {
    const url = req.url || '/';
    const pathOnly = url.split('?')[0];
    const key = `${req.method} ${pathOnly}`;

    if (ROUTES[key]) {
        ROUTES[key](req, res);
        return;
    }
    if (req.method === 'GET') {
        handleStatic(req, res, pathOnly);
        return;
    }
    send(res, 404, 'Not Found');
}

const server = http.createServer((req, res) => {
    try {
        dispatch(req, res);
    } catch (e) {
        logServer(`excepcao no dispatcher: ${(e && e.stack) || e}`);
        try { sendJson(res, 500, { error: 'erro interno' }); } catch (_) {}
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`>> ERRO: porto ${PORT} ja em uso. Outra instancia do servidor esta a correr?`);
        logServer(`EADDRINUSE em ${HOST}:${PORT}`);
        process.exit(1);
    }
    console.error(`>> ERRO no servidor: ${err.message}`);
    logServer(`server error: ${err.message}`);
    process.exit(1);
});

ensureDir(DATA_DIR);
ensureDir(LOGS_DIR);

server.listen(PORT, HOST, () => {
    const msg = `>> ui server a escutar em http://${HOST}:${PORT}`;
    console.log(msg);
    logServer(msg);
});

function shutdown(sig) {
    logServer(`recebido ${sig}, a encerrar...`);
    server.close(() => {
        logServer('servidor fechado.');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
