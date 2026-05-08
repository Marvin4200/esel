'use strict';
const express = require('express');
const compression = require('compression');
const path = require('path');
const https = require('https');
const http = require('http');
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
