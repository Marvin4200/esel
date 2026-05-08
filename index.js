'use strict';
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3015;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'esel', uptime: process.uptime() }));
app.listen(PORT, () => console.log(`[esel.eselbande.com] Running on port ${PORT}`));
