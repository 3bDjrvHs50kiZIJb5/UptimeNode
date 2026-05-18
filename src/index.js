import './env.js';
import http from 'node:http';
import { ensureStorage, loadSites, loadReport, upsertSite } from './storage.js';
import { defaultConfig } from './config.js';
import { pollOnce, startPolling, getSnapshot } from './monitor.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html)
  });
  res.end(html);
}

function renderLoginPage(message = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UptimeNode 登录</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fb; color: #1f2937; }
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { width: 100%; max-width: 420px; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0 0 16px; color: #6b7280; }
    input, button { width: 100%; box-sizing: border-box; }
    input { padding: 12px 14px; border-radius: 10px; border: 1px solid #d1d5db; font-size: 16px; }
    button { margin-top: 12px; border: 0; border-radius: 10px; padding: 12px 14px; background: #2563eb; color: white; font-size: 16px; cursor: pointer; }
    .msg { margin-top: 12px; color: #dc2626; min-height: 1.2em; }
  </style>
</head>
<body>
  <div class="wrap">
    <form class="card" method="POST" action="/login">
      <h1>请输入访问密码</h1>
      <p>登录后才能查看站点监控页面。</p>
      <input type="password" name="password" placeholder="请输入密码" autofocus />
      <button type="submit">进入</button>
      <div class="msg">${escapeHtml(message)}</div>
    </form>
  </div>
</body>
</html>`;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UptimeNode 站点监控</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --card: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --line: #e5e7eb;
      --green: #16a34a;
      --red: #dc2626;
      --amber: #d97706;
      --blue: #2563eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 20px;
    }
    .title h1 { margin: 0 0 6px; font-size: 28px; }
    .title p { margin: 0; color: var(--muted); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button {
      border: 0;
      border-radius: 10px;
      padding: 10px 14px;
      cursor: pointer;
      font-size: 14px;
      background: var(--blue);
      color: white;
    }
    button.secondary { background: #374151; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 1px 2px rgba(0,0,0,.04);
    }
    .metric-label { color: var(--muted); font-size: 13px; }
    .metric-value { font-size: 28px; font-weight: 700; margin-top: 6px; }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin: 20px 0 12px;
      flex-wrap: wrap;
    }
    .toolbar input {
      min-width: 280px;
      max-width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--line);
      font-size: 14px;
    }
    .table-wrap {
      overflow: auto;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      text-align: left;
      white-space: nowrap;
      font-size: 14px;
    }
    th { background: #fafafa; font-size: 13px; color: var(--muted); }
    tr:last-child td { border-bottom: 0; }
    .status-up { color: var(--green); font-weight: 700; }
    .status-down { color: var(--red); font-weight: 700; }
    .status-warn { color: var(--amber); font-weight: 700; }
    .muted { color: var(--muted); }
    .small { font-size: 12px; color: var(--muted); }
    .pill {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      background: #eef2ff;
      color: #4338ca;
      font-size: 12px;
      margin-right: 4px;
      margin-bottom: 4px;
    }
    .footer {
      margin-top: 16px;
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 960px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .header { flex-direction: column; }
    }
    @media (max-width: 560px) {
      .grid { grid-template-columns: 1fr; }
      .toolbar input { min-width: 0; width: 100%; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="title">
        <h1>UptimeNode 站点监控</h1>
        <p>首页直接展示每个站点的可达性、HTTP 状态、响应时间、关键字和 SSL 情况。</p>
      </div>
      <div class="actions">
        <button id="refreshBtn">手动检查一次</button>
        <button id="reloadBtn" class="secondary">刷新页面数据</button>
      </div>
    </div>

    <div class="grid">
      <div class="card"><div class="metric-label">站点总数</div><div class="metric-value" id="totalCount">0</div></div>
      <div class="card"><div class="metric-label">正常站点</div><div class="metric-value" id="upCount">0</div></div>
      <div class="card"><div class="metric-label">异常站点</div><div class="metric-value" id="downCount">0</div></div>
      <div class="card"><div class="metric-label">最近检查</div><div class="metric-value" style="font-size:18px" id="updatedAt">-</div></div>
    </div>

    <div class="toolbar">
      <div class="small" id="summaryText">正在加载站点信息...</div>
      <input id="searchInput" type="search" placeholder="搜索站点名称、URL、状态或关键字" />
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>URL</th>
            <th>状态</th>
            <th>HTTP</th>
            <th>延迟</th>
            <th>关键字</th>
            <th>最近错误</th>
            <th>SSL 剩余天数</th>
            <th>检查时间</th>
          </tr>
        </thead>
        <tbody id="siteRows">
          <tr><td colspan="9" class="muted">加载中...</td></tr>
        </tbody>
      </table>
    </div>

    <div class="footer">
      接口：<code>/health</code>、<code>/sites</code>、<code>/poll</code>、<code>/report</code>、<code>/snapshot</code>
    </div>
  </div>

  <script>
    const els = {
      totalCount: document.getElementById('totalCount'),
      upCount: document.getElementById('upCount'),
      downCount: document.getElementById('downCount'),
      updatedAt: document.getElementById('updatedAt'),
      summaryText: document.getElementById('summaryText'),
      siteRows: document.getElementById('siteRows'),
      searchInput: document.getElementById('searchInput'),
      refreshBtn: document.getElementById('refreshBtn'),
      reloadBtn: document.getElementById('reloadBtn')
    };

    let report = { updatedAt: null, sites: [] };
    let sites = [];

    function formatDateTime(value) {
      if (!value) return '-';
      try {
        return new Date(value).toLocaleString('zh-CN');
      } catch {
        return value;
      }
    }

    function renderRows() {
      const keyword = els.searchInput.value.trim().toLowerCase();
      const merged = sites.map(site => {
        const reportItem = report.sites.find(item => item.url === site.url) || {};
        return { ...site, ...reportItem };
      });

      const filtered = merged.filter(item => {
        if (!keyword) return true;
        const pool = [item.name, item.url, item.status, item.errorMessage, item.matchedKeyword]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return pool.includes(keyword);
      });

      const upCount = merged.filter(item => item.status === 'up').length;
      const downCount = merged.filter(item => item.status === 'down').length;

      els.totalCount.textContent = String(merged.length);
      els.upCount.textContent = String(upCount);
      els.downCount.textContent = String(downCount);
      els.updatedAt.textContent = formatDateTime(report.updatedAt);
      els.summaryText.textContent = '已加载 ' + merged.length + ' 个站点，' + upCount + ' 个正常，' + downCount + ' 个异常。';

      if (filtered.length === 0) {
        els.siteRows.innerHTML = '<tr><td colspan="9" class="muted">没有匹配的站点</td></tr>';
        return;
      }

      els.siteRows.innerHTML = filtered.map(item => {
        const statusClass = item.status === 'up' ? 'status-up' : item.status === 'down' ? 'status-down' : 'status-warn';
        const keywordResult = item.status === 'down'
          ? '<span class="status-down">未命中</span>'
          : item.keywordMatched === false
            ? '<span class="status-down">未命中</span>'
            : '<span class="status-up">命中</span>';
        const sslDaysText = typeof item.sslDaysLeft === 'number' ? item.sslDaysLeft + ' 天' : '-';
        return '<tr>' +
          '<td><strong>' + escapeHtml(item.name || '-') + '</strong></td>' +
          '<td><a href="' + escapeHtml(item.url || '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(item.url || '-') + '</a></td>' +
          '<td class="' + statusClass + '">' + escapeHtml(item.status || '-') + '</td>' +
          '<td>' + escapeHtml(item.httpStatus ?? '-') + '</td>' +
          '<td>' + escapeHtml(item.latencyMs ?? '-') + ' ms</td>' +
          '<td>' + keywordResult + '</td>' +
          '<td>' + escapeHtml(item.errorMessage || '-') + '</td>' +
          '<td>' + escapeHtml(sslDaysText) + '</td>' +
          '<td>' + escapeHtml(formatDateTime(item.checkedAt)) + '</td>' +
          '</tr>';
      }).join('');
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    async function loadData() {
      const [sitesResp, reportResp] = await Promise.all([
        fetch('/sites'),
        fetch('/report')
      ]);
      const sitesData = await sitesResp.json();
      const reportData = await reportResp.json();
      sites = sitesData.sites || [];
      report = reportData || { updatedAt: null, sites: [] };
      renderRows();
    }

    async function refreshNow() {
      els.summaryText.textContent = '正在执行检查...';
      await fetch('/poll', { method: 'POST' });
      await loadData();
    }

    els.searchInput.addEventListener('input', renderRows);
    els.reloadBtn.addEventListener('click', () => loadData());
    els.refreshBtn.addEventListener('click', () => refreshNow());

    loadData().catch(error => {
      els.summaryText.textContent = '加载失败：' + error.message;
      els.siteRows.innerHTML = '<tr><td colspan="9" class="muted">加载失败</td></tr>';
    });
  </script>
</body>
</html>`;
}

async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/') {
    const cookie = req.headers.cookie || '';
    const loggedIn = cookie.split(';').some(item => item.trim() === 'uptime_auth=1');
    if (!defaultConfig.pagePassword) {
      return sendHtml(res, 200, renderPage());
    }
    if (!loggedIn) {
      return sendHtml(res, 200, renderLoginPage());
    }
    return sendHtml(res, 200, renderPage());
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    const body = await readRequestBody(req);
    if (!defaultConfig.pagePassword) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    if (String(body.password || '') === defaultConfig.pagePassword) {
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': 'uptime_auth=1; HttpOnly; Path=/; SameSite=Lax'
      });
      return res.end();
    }
    return sendHtml(res, 401, renderLoginPage('密码错误，请重试。'));
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, message: 'running' });
  }

  if (req.method === 'GET' && url.pathname === '/sites') {
    const sites = await loadSites();
    return sendJson(res, 200, { sites });
  }

  if (req.method === 'POST' && url.pathname === '/sites') {
    const body = await readRequestBody(req);
    if (!body.name || !body.url) {
      return sendJson(res, 400, { ok: false, message: 'name 和 url 必填' });
    }
    const sites = await upsertSite(body);
    return sendJson(res, 200, { ok: true, sites });
  }

  if (req.method === 'POST' && url.pathname === '/poll') {
    const report = await pollOnce();
    return sendJson(res, 200, report);
  }

  if (req.method === 'GET' && url.pathname === '/report') {
    const report = await loadReport();
    return sendJson(res, 200, report);
  }

  if (req.method === 'GET' && url.pathname === '/snapshot') {
    return sendJson(res, 200, { sites: getSnapshot() });
  }

  return sendJson(res, 404, { ok: false, message: 'not found' });
}

async function main() {
  await ensureStorage();
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((req, res) => {
    void handler(req, res).catch(error => {
      console.error('[server] request failed:', error);
      sendJson(res, 500, { ok: false, message: 'internal server error' });
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[server] listening on ${port}`);
  });

  const timer = startPolling();
  const shutdown = () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('[boot] failed:', error);
  process.exit(1);
});
