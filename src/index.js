import './env.js';
import http from 'node:http';
import { ensureStorage, loadSites, loadReport, upsertSite } from './storage.js';
import { defaultConfig, isDevMode, isTelegramEnabled } from './config.js';
import { pollOnce, startPolling, getSnapshot } from './monitor.js';
import { startTelegramCommandPolling, sendTelegramMessage } from './notifier.js';
import { sendEmail } from './email.js';
import { createLogger } from './logger.js';
import {
  renderDashboardPage,
  renderLoginPage,
  resolvePublicAsset,
  readPublicAsset
} from './pages.js';

const log = createLogger('server');

// 统一返回 JSON 响应。
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// 统一返回 HTML 响应。
function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html)
  });
  res.end(html);
}

// 返回静态资源。
function sendAsset(res, statusCode, body, contentType) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// 判断当前请求是否已经通过密码登录。
function isLoggedIn(req) {
  const cookie = req.headers.cookie || '';
  return cookie.split(';').some(item => item.trim() === 'uptime_auth=1');
}

// 读取并解析请求体。
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

// 处理所有 HTTP 路由。
async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  log.info('request received', { method: req.method, path: url.pathname });

  if (req.method === 'GET') {
    const assetPath = resolvePublicAsset(url.pathname);
    if (assetPath) {
      try {
        const asset = await readPublicAsset(assetPath);
        return sendAsset(res, 200, asset.body, asset.contentType);
      } catch (error) {
        log.warn('asset not found', { assetPath, error: error instanceof Error ? error.message : String(error) });
        return sendJson(res, 404, { ok: false, message: 'not found' });
      }
    }
  }

  if (req.method === 'GET' && url.pathname === '/') {
    if (!defaultConfig.pagePassword) {
      return sendHtml(res, 200, await renderDashboardPage());
    }
    if (!isLoggedIn(req)) {
      return sendHtml(res, 200, await renderLoginPage());
    }
    return sendHtml(res, 200, await renderDashboardPage());
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    const body = await readRequestBody(req);
    if (!defaultConfig.pagePassword) {
      log.info('login bypassed because password is not configured');
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    if (String(body.password || '') === defaultConfig.pagePassword) {
      log.info('login success');
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': 'uptime_auth=1; HttpOnly; Path=/; SameSite=Lax'
      });
      return res.end();
    }
    log.warn('login failed');
    return sendHtml(res, 401, await renderLoginPage('密码错误，请重试。'));
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, message: 'running' });
  }

  if (req.method === 'GET' && url.pathname === '/sites') {
    const sites = await loadSites();
    log.debug('sites fetched', { count: sites.length });
    return sendJson(res, 200, { sites });
  }

  if (req.method === 'POST' && url.pathname === '/sites') {
    const body = await readRequestBody(req);
    if (!body.name || !body.url) {
      log.warn('site upsert rejected because name or url is missing');
      return sendJson(res, 400, { ok: false, message: 'name 和 url 必填' });
    }
    const sites = await upsertSite(body);
    log.info('site upserted via api', {
      name: String(body.name || '').trim(),
      url: String(body.url || '').trim(),
      count: sites.length
    });
    return sendJson(res, 200, { ok: true, sites });
  }

  if (req.method === 'POST' && url.pathname === '/poll') {
    log.info('manual poll requested');
    const report = await pollOnce();
    log.info('manual poll finished', {
      updatedAt: report.updatedAt,
      siteCount: report.sites.length
    });
    return sendJson(res, 200, report);
  }

  function buildTestAuthorization() {
    return isLoggedIn(req);
  }

  if (req.method === 'POST' && url.pathname === '/test-telegram') {
    if (!buildTestAuthorization()) {
      log.warn('telegram test unauthorized');
      return sendJson(res, 401, { ok: false, message: 'unauthorized' });
    }

    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const telegramMessage = [
      '🧪 <b>测试通知</b>',
      '',
      '如果你能看到这条消息，说明 Telegram 通知配置正常。',
      '',
      `⏰ <b>发送时间:</b> ${timestamp}`
    ].join('\n');

    const telegramOk = await sendTelegramMessage(telegramMessage);
    const ok = telegramOk;
    const message = ok ? 'Telegram 测试消息已发送' : 'Telegram 测试消息发送失败';
    log[ok ? 'info' : 'warn']('telegram test finished', { ok });

    return sendJson(res, 200, {
      ok,
      message,
      telegramOk
    });
  }

  if (req.method === 'POST' && url.pathname === '/test-email') {
    if (!buildTestAuthorization()) {
      log.warn('email test unauthorized');
      return sendJson(res, 401, { ok: false, message: 'unauthorized' });
    }

    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const emailPayload = {
      to: defaultConfig.emailTo || process.env.EMAIL_TO || '',
      subject: 'UptimeNode 测试通知',
      text: [
        'UptimeNode 测试通知',
        '',
        '如果你能收到这封邮件，说明邮件通知配置正常。',
        `发送时间：${timestamp}`
      ].join('\n'),
      html: [
        '<h3>UptimeNode 测试通知</h3>',
        '<p>如果你能收到这封邮件，说明邮件通知配置正常。</p>',
        `<p><b>发送时间：</b>${timestamp}</p>`
      ].join('')
    };

    const emailOk = await sendEmail(emailPayload);
    const ok = emailOk;
    const message = ok ? '邮件测试已发送' : '邮件测试发送失败';
    log[ok ? 'info' : 'warn']('email test finished', { ok });

    return sendJson(res, 200, {
      ok,
      message,
      emailOk
    });
  }

  if (req.method === 'GET' && url.pathname === '/report') {
    const report = await loadReport();
    log.debug('report fetched', { updatedAt: report.updatedAt, siteCount: Array.isArray(report.sites) ? report.sites.length : 0 });
    return sendJson(res, 200, report);
  }

  if (req.method === 'GET' && url.pathname === '/snapshot') {
    log.debug('snapshot fetched');
    return sendJson(res, 200, { sites: getSnapshot() });
  }

  return sendJson(res, 404, { ok: false, message: 'not found' });
}

// 启动服务并初始化轮询任务。
async function main() {
  await ensureStorage();
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((req, res) => {
    void handler(req, res).catch(error => {
      log.error('request failed', error);
      sendJson(res, 500, { ok: false, message: 'internal server error' });
    });
  });

  server.listen(port, '0.0.0.0', () => {
    log.info('listening', { port, devMode: isDevMode(), telegramEnabled: isTelegramEnabled() });
  });

  const timer = startPolling();
  const telegramPolling = startTelegramCommandPolling();
  const shutdown = () => {
    log.info('shutdown requested');
    clearInterval(timer);
    telegramPolling.stop();
    server.close(() => {
      log.info('shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  log.error('boot failed', error);
  process.exit(1);
});
