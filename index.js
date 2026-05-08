'use strict';
const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const app = express();
const PORT = process.env.PORT || 3015;

const ESEL_FILES = [
  'Donkey_1_arp_750px.jpg',
  'Donkey_in_Clovelly%2C_North_Devon%2C_England.jpg',
  'Equus_africanus_asinus_2005.jpg',
  'Two_donkeys_2012.jpg',
  'Donkey_Equus_asinus.jpg',
  'Donkey_in_Jordan.jpg',
  'Burro%28Equus_asinus%2904.jpg',
  'Esel_1_Zugspitze.jpg',
  'Donkey_in_Santorini.jpg',
  'Baby_donkey_%28Equus_asinus%29_at_the_Honolulu_Zoo.jpg',
];

function fetchUrl(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects === 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'EselBot/1.0 (https://esel.eselbande.com; marvin@eselbande.com)',
        'Accept': 'image/*',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      resolve(res);
    }).on('error', reject);
  });
}

app.get('/api/esel', async (req, res) => {
  const files = [...ESEL_FILES];
  // shuffle to try random order
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
  for (const file of files) {
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${file}`;
    try {
      const stream = await fetchUrl(url);
      res.set('Content-Type', stream.headers['content-type'] || 'image/jpeg');
      res.set('Cache-Control', 'no-store');
      stream.pipe(res);
      return;
    } catch (e) {
      // try next
    }
  }
  res.status(502).json({ error: 'no esel found' });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'esel', uptime: process.uptime() }));
app.listen(PORT, () => console.log(`[esel.eselbande.com] Running on port ${PORT}`));
