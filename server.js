/**
 * Minimal Express service for Render.
 *
 * GET / serves the generated dashboard.html.
 * GET /health returns ok.
 */

const path = require('path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 3000);
const dashboardPath = path.join(__dirname, 'dashboard.html');

app.get('/health', (req, res) => {
  res.type('text/plain').send('ok');
});

app.get('/', (req, res) => {
  res.sendFile(dashboardPath);
});

app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Flight price dashboard server listening on port ${port}`);
});
