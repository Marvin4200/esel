'use strict';
const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const app = express();
const PORT = process.env.PORT || 3015;

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
    res.set('Content-Type', stream.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    stream.pipe(res);
  } catch (e) {
    res.status(502).json({ error: 'no esel found' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'esel', uptime: process.uptime() }));
app.listen(PORT, () => console.log(`[esel.eselbande.com] Running on port ${PORT}`));
