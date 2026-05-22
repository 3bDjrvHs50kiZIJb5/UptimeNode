const els = {
  totalCount: document.getElementById('totalCount'),
  upCount: document.getElementById('upCount'),
  downCount: document.getElementById('downCount'),
  updatedAt: document.getElementById('updatedAt'),
  summaryText: document.getElementById('summaryText'),
  siteRows: document.getElementById('siteRows'),
  searchInput: document.getElementById('searchInput'),
  refreshBtn: document.getElementById('refreshBtn'),
  testTelegramBtn: document.getElementById('testTelegramBtn'),
  testEmailBtn: document.getElementById('testEmailBtn'),
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderRows() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const merged = sites.map(site => {
    const reportItem = report.sites.find(item => item.url === site.url) || {};
    return { ...site, ...reportItem };
  });

  const filtered = merged.filter(item => {
    if (!keyword) return true;
    const cfSearch = item.cfProxied === true ? '是 橙云' : item.cfProxied === false ? '否' : '未知';
    const pool = [item.name, item.url, item.status, item.errorMessage, item.matchedKeyword, cfSearch]
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
    els.siteRows.innerHTML = '<tr><td colspan="10" class="muted">没有匹配的站点</td></tr>';
    return;
  }

  els.siteRows.innerHTML = filtered.map(item => {
    const threshold = Number(item.failureThreshold || 10);
    const pendingFailures = Number(item.consecutiveFailures || 0);
    let statusText = item.status || '-';
    let statusClass = 'status-warn';
    if (item.status === 'down') {
      statusClass = 'status-down';
    } else if (pendingFailures > 0) {
      statusText = 'up (' + pendingFailures + '/' + threshold + ')';
      statusClass = 'status-warn';
    } else {
      statusText = 'up';
      statusClass = 'status-up';
    }
    const keywordResult = item.checkOk === false && item.keywordMatched === false
      ? '<span class="status-down">未命中</span>'
      : item.checkOk === false
        ? '<span class="status-down">-</span>'
        : item.keywordMatched === false
          ? '<span class="status-down">未命中</span>'
          : '<span class="status-up">命中</span>';
    const sslDaysText = item.cfProxied === true
      ? '-'
      : typeof item.sslDaysLeft === 'number'
        ? item.sslDaysLeft + ' 天'
        : '-';
    let cfProxiedText = '未知';
    let cfProxiedClass = 'status-warn';
    if (item.cfProxied === true) {
      cfProxiedText = '是';
      cfProxiedClass = 'status-up';
    } else if (item.cfProxied === false) {
      cfProxiedText = '否';
      cfProxiedClass = '';
    }
    const cfTitle = item.cfProxiedReason ? ' title="' + escapeHtml(item.cfProxiedReason) + '"' : '';
    return '<tr>' +
      '<td><strong>' + escapeHtml(item.name || '-') + '</strong></td>' +
      '<td><a href="' + escapeHtml(item.url || '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(item.url || '-') + '</a></td>' +
      '<td class="' + statusClass + '">' + escapeHtml(statusText) + '</td>' +
      '<td>' + escapeHtml(item.httpStatus ?? '-') + '</td>' +
      '<td>' + escapeHtml(item.latencyMs ?? '-') + ' ms</td>' +
      '<td>' + keywordResult + '</td>' +
      '<td>' + escapeHtml(item.errorMessage || '-') + '</td>' +
      '<td class="' + cfProxiedClass + '"' + cfTitle + '>' + escapeHtml(cfProxiedText) + '</td>' +
      '<td>' + escapeHtml(sslDaysText) + '</td>' +
      '<td>' + escapeHtml(formatDateTime(item.checkedAt)) + '</td>' +
      '</tr>';
  }).join('');
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

async function testTelegram() {
  els.summaryText.textContent = '正在发送 Telegram 测试...';
  const response = await fetch('/test-telegram', { method: 'POST' });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Telegram 测试发送失败');
  }
  els.summaryText.textContent = data.message || 'Telegram 测试已发送';
}

async function testEmail() {
  els.summaryText.textContent = '正在发送邮件测试...';
  const response = await fetch('/test-email', { method: 'POST' });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || '邮件测试发送失败');
  }
  els.summaryText.textContent = data.message || '邮件测试已发送';
}

els.searchInput.addEventListener('input', renderRows);
els.reloadBtn.addEventListener('click', () => loadData());
els.refreshBtn.addEventListener('click', () => refreshNow());
els.testTelegramBtn.addEventListener('click', () => testTelegram().catch(error => {
  els.summaryText.textContent = 'Telegram 测试失败：' + error.message;
}));
els.testEmailBtn.addEventListener('click', () => testEmail().catch(error => {
  els.summaryText.textContent = '邮件测试失败：' + error.message;
}));

loadData().catch(error => {
  els.summaryText.textContent = '加载失败：' + error.message;
  els.siteRows.innerHTML = '<tr><td colspan="10" class="muted">加载失败</td></tr>';
});
