'use strict';
const express = require('express');
const compression = require('compression');
const path = require('path');
const https = require('https');
const http = require('http');


// ── Admin-Log ─────────────────────────────────────────────────────────────────
// Faengt praktisch alles ab: nicht nur Abstuerze, sondern auch die vielen
// try/catch-Stellen im Code, die einen Fehler bisher nur lokal geloggt haben.
// console.error/console.warn werden global umgeleitet - jeder Aufruf,
// egal wo im Prozess, geht jetzt zusaetzlich an admin.eselbande.com.
const ADMIN_LOG_URL = (process.env.ADMIN_LOG_URL || '').replace(/\/+$/, '');
const LOG_INGEST_TOKEN = process.env.LOG_INGEST_TOKEN || '';

// Ratenbegrenzung: waehrend eines Fehlersturms (z.B. eine haengende
// Verbindung, die minuetlich denselben Fehler wirft) soll admin-dashboard
// nicht mit hunderten Anfragen pro Minute geflutet werden. Token-Bucket:
// 30 Log-Sendungen sofort verfuegbar, danach eine neue alle 2 Sekunden.
let _logTokens = 30;
setInterval(() => { _logTokens = Math.min(30, _logTokens + 1); }, 2000);
let _logSuppressedSince = 0;

async function logAdmin(type, title, description, color, fields) {
    if (!ADMIN_LOG_URL || !LOG_INGEST_TOKEN) return;
    if (_logTokens <= 0) { _logSuppressedSince++; return; }
    _logTokens--;
    if (_logSuppressedSince > 0) {
        const n = _logSuppressedSince;
        _logSuppressedSince = 0;
        logAdmin('SYSTEM', '\u{1F507} Logs gedrosselt', `${n} weitere Meldungen in kurzer Zeit wurden nicht einzeln gesendet (Ratenbegrenzung).`, 0xF59E0B);
    }
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        await fetch(`${ADMIN_LOG_URL}/api/logs/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Log-Token': LOG_INGEST_TOKEN },
            body: JSON.stringify({ source: 'esel', type, title, description, color, fields }),
            signal: controller.signal,
        }).catch(() => {});
        clearTimeout(timer);
    } catch { /* ein Log-Sendefehler darf den Dienst selbst nie beeintraechtigen */ }
}

function _fmtConsoleArgs(args) {
    return args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
    }).join(' ').slice(0, 4000);
}

const _origConsoleError = console.error.bind(console);
const _origConsoleWarn = console.warn.bind(console);
console.error = (...args) => {
    _origConsoleError(...args);
    logAdmin('ERRORS', '\u{26A0}\u{FE0F} Fehler', _fmtConsoleArgs(args), 0xED4245);
};
console.warn = (...args) => {
    _origConsoleWarn(...args);
    logAdmin('WARNINGS', '\u{26A0}\u{FE0F} Warnung', _fmtConsoleArgs(args), 0xF59E0B);
};

process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
});
logAdmin('SYSTEM', '\u{1F680} esel gestartet', `Prozess laeuft, PID ${process.pid}.`, 0x57F287);


const app = express();
const PORT = process.env.PORT || 3015;
// Security headers + CSP
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://loremflickr.com https://live.staticflickr.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
  next();
});
app.use(compression());


// loremflickr returns a random CC-licensed flickr photo per request
const LOREMFLICKR_URL = 'https://loremflickr.com/800/600/donkey';

function fetchImage(url, baseUrl, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'EselBot/1.0 (https://esel.eselbande.com)' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const location = res.headers.location;
        const next = location.startsWith('http') ? location : new URL(location, baseUrl || url).href;
        return resolve(fetchImage(next, baseUrl || url, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

app.get('/api/esel', async (req, res) => {
  try {
    const stream = await fetchImage(LOREMFLICKR_URL);
    const upstreamContentType = String(stream.headers['content-type'] || 'image/jpeg');
    if (!upstreamContentType.toLowerCase().startsWith('image/')) {
      stream.resume();
      return res.status(502).json({ error: 'invalid upstream content-type' });
    }
    res.set('Content-Type', upstreamContentType);
    res.set('Cache-Control', 'no-store');
    stream.pipe(res);
  } catch (e) {
    res.status(502).json({ error: 'no esel found' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'esel', uptime: process.uptime() }));

// ── 404 & Error handlers ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Nicht gefunden', path: req.path }));
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Interner Serverfehler' });
});

const server = app.listen(PORT, () => console.log(`[esel.eselbande.com] Running on port ${PORT}`));

function shutdown(signal) {
  console.log(`[SHUTDOWN] ${signal} received`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
