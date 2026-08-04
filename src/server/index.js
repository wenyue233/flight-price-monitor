/**
 * 生成済み dashboard と health check を提供する Express サーバー。
 */

const path = require('path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 3000);
const projectRoot = path.resolve(__dirname, '..', '..');
const dashboardPath = path.join(projectRoot, 'dashboard.html');

app.get('/health', (req, res) => {
  res.type('text/plain').send('ok');
});

app.get('/', (req, res) => {
  res.sendFile(dashboardPath);
});

app.use(express.static(projectRoot));

app.listen(port, () => {
  console.log(`Flight price dashboard server listening on port ${port}`);
});
