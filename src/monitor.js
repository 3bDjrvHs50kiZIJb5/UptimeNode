import './env.js';
import https from 'node:https';
import tls from 'node:tls';
import { loadSites, saveReport } from './storage.js';
import { sendTelegramMessage, formatSiteDownMessage, formatSiteRecoveryMessage, formatSslExpiryMessage } from './notifier.js';
import { sendEmail, formatSiteDownEmail, formatSiteRecoveryEmail, formatSslExpiryEmail } from './email.js';
import { createLogger } from './logger.js';

const log = createLogger('monitor');

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const state = new Map();

// 统一整理站点 URL，去掉首尾空格。
function normalizeUrl(input) {
  return String(input || '').trim();
}

// 从 URL 中提取主机名，供后续判断使用。
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// 把秒数换算成天数。
function secondsToDays(seconds) {
  return Math.floor(seconds / 86400);
}

// 带超时控制地请求页面内容。
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - start,
      body: text
    };
  } finally {
    clearTimeout(timer);
  }
}

// 检查站点 SSL 证书剩余时间和状态。
async function checkSslCertificate(url, timeoutMs) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return {
        sslStatus: 'not_applicable',
        sslError: null,
        sslDaysLeft: null,
        sslHoursLeft: null,
        sslExpiresAt: null
      };
    }

    const host = parsed.hostname;
    const port = Number(parsed.port || 443);

    const result = await new Promise((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        rejectUnauthorized: true
      });

      const timer = setTimeout(() => {
        socket.destroy(new Error('SSL 连接超时'));
      }, timeoutMs);

      socket.once('secureConnect', () => {
        clearTimeout(timer);
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert);
      });

      socket.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const validTo = result?.valid_to || null;
    if (!validTo) {
      return {
        sslStatus: 'up',
        sslError: null,
        sslDaysLeft: null,
        sslHoursLeft: null,
        sslExpiresAt: null
      };
    }

    const expiresAt = new Date(validTo);
    const hoursLeft = Math.max(0, (expiresAt.getTime() - Date.now()) / 3600000);
    const daysLeft = secondsToDays(Math.max(0, (expiresAt.getTime() - Date.now()) / 1000));

    return {
      sslStatus: 'up',
      sslError: null,
      sslDaysLeft: daysLeft,
      sslHoursLeft: hoursLeft,
      sslExpiresAt: expiresAt.toISOString()
    };
  } catch (error) {
    return {
      sslStatus: 'down',
      sslError: error instanceof Error ? error.message : String(error),
      sslDaysLeft: null,
      sslHoursLeft: null,
      sslExpiresAt: null
    };
  }
}

// 判断页面内容是否命中配置的关键字。
function evaluateKeywords(body, keywords = []) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return {
      keywordEnabled: false,
      keywordMatched: null,
      matchedKeyword: null
    };
  }

  const lowerBody = String(body || '').toLowerCase();
  const matchedKeyword = keywords.find(keyword => lowerBody.includes(String(keyword).toLowerCase()));
  return {
    keywordEnabled: true,
    keywordMatched: Boolean(matchedKeyword),
    matchedKeyword: matchedKeyword || null
  };
}

// 执行单次站点探测，返回本次检测是否成功（不等同于站点最终状态）。
async function checkSite(site, config) {
  const url = normalizeUrl(site.url);
  log.debug('checking site', { name: site.name, url });
  const sslResult = await checkSslCertificate(url, config.sslCheckTimeoutMs);

  try {
    const response = await fetchWithTimeout(url, config.requestTimeoutMs);
    const keywordResult = evaluateKeywords(response.body, site.keywords || []);
    const checkOk = response.ok && (keywordResult.keywordEnabled ? keywordResult.keywordMatched : true);
    const errorMessage = checkOk
      ? null
      : response.ok
        ? '页面未包含指定关键字'
        : `HTTP ${response.status}`;

    return {
      name: site.name,
      url,
      checkOk,
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      errorMessage,
      matchedKeyword: keywordResult.matchedKeyword,
      keywordMatched: keywordResult.keywordMatched,
      sslStatus: sslResult.sslStatus,
      sslError: sslResult.sslError,
      sslDaysLeft: sslResult.sslDaysLeft,
      sslHoursLeft: sslResult.sslHoursLeft,
      sslExpiresAt: sslResult.sslExpiresAt,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    log.warn('site probe failed', {
      name: site.name,
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      name: site.name,
      url,
      checkOk: false,
      httpStatus: 0,
      latencyMs: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
      keywordEnabled: false,
      matchedKeyword: null,
      keywordMatched: null,
      sslStatus: sslResult.sslStatus,
      sslError: sslResult.sslError,
      sslDaysLeft: sslResult.sslDaysLeft,
      sslHoursLeft: sslResult.sslHoursLeft,
      sslExpiresAt: sslResult.sslExpiresAt,
      checkedAt: new Date().toISOString()
    };
  }
}

// 根据连续失败次数确定站点状态，并在确认宕机/恢复时发送告警。
async function applyFailureState(site, result, previousState, failureThreshold) {
  const wasConfirmedDown = previousState?.status === 'down';
  result.failureThreshold = failureThreshold;

  if (!result.checkOk) {
    const nextFailures = (previousState?.consecutiveFailures || 0) + 1;
    result.consecutiveFailures = nextFailures;

    if (nextFailures >= failureThreshold) {
      result.status = 'down';
      if (!wasConfirmedDown) {
        const telegramOk = await sendTelegramMessage(formatSiteDownMessage(site, result));
        const email = formatSiteDownEmail(site, result);
        const emailOk = await sendEmail({
          to: process.env.EMAIL_TO || '',
          subject: email.subject,
          text: email.text,
          html: email.html
        });
        result.emailAlertSent = emailOk;
        log.info('down alerts processed', {
          name: site.name,
          url: site.url,
          consecutiveFailures: nextFailures,
          failureThreshold,
          telegramOk,
          emailOk
        });
      }
    } else {
      result.status = 'up';
      result.emailAlertSent = previousState?.emailAlertSent || false;
    }
  } else {
    result.consecutiveFailures = 0;
    result.status = 'up';
    result.errorMessage = null;

    if (wasConfirmedDown) {
      const telegramOk = await sendTelegramMessage(formatSiteRecoveryMessage(site, result));
      const email = formatSiteRecoveryEmail(site, result);
      const emailOk = await sendEmail({
        to: process.env.EMAIL_TO || '',
        subject: email.subject,
        text: email.text,
        html: email.html
      });
      log.info('recovery notifications processed', {
        name: site.name,
        url: site.url,
        telegramOk,
        emailOk
      });
    }

    result.emailAlertSent = false;
  }
}

// 处理 SSL 到期类告警（与站点连续失败逻辑无关）。
async function handleSslAlerts(site, result, previousState) {
  if (result.sslStatus === 'up' && typeof result.sslDaysLeft === 'number') {
    if (result.sslDaysLeft <= 7) {
      const lastAlertAt = previousState?.sslLastAlertAt || 0;
      const shouldSend = result.sslDaysLeft < 2
        ? lastAlertAt === 0 || Date.now() - lastAlertAt >= 3600000
        : lastAlertAt === 0 || new Date(lastAlertAt).toDateString() !== new Date().toDateString();

      if (shouldSend) {
        const telegramOk = await sendTelegramMessage(formatSslExpiryMessage(site, result));
        const email = formatSslExpiryEmail(site, result);
        const emailOk = await sendEmail({
          to: process.env.EMAIL_TO || '',
          subject: email.subject,
          text: email.text,
          html: email.html
        });
        result.sslLastAlertAt = Date.now();
        log.info('ssl alert processed', {
          name: site.name,
          url: site.url,
          sslDaysLeft: result.sslDaysLeft,
          telegramOk,
          emailOk
        });
      } else {
        result.sslLastAlertAt = lastAlertAt;
      }
    }
  }
}

// 手动或定时触发一次全量站点检测。
export async function pollOnce() {
  const config = {
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10000),
    sslCheckTimeoutMs: Number(process.env.SSL_CHECK_TIMEOUT_MS || 10000),
    failureThreshold: Number(process.env.FAILURE_THRESHOLD || 10)
  };

  const sites = await loadSites();
  const results = [];
  log.info('poll started', { siteCount: sites.length, failureThreshold: config.failureThreshold });

  for (const site of sites) {
    const previousState = state.get(site.url) || null;
    const result = await checkSite(site, config);
    result.sslLastAlertAt = previousState?.sslLastAlertAt || 0;
    await applyFailureState(site, result, previousState, config.failureThreshold);
    await handleSslAlerts(site, result, previousState);
    state.set(site.url, result);
    results.push(result);
    log.info('site checked', {
      name: result.name,
      url: result.url,
      checkOk: result.checkOk,
      status: result.status,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      sslStatus: result.sslStatus,
      sslDaysLeft: result.sslDaysLeft,
      consecutiveFailures: result.consecutiveFailures,
      failureThreshold: config.failureThreshold,
      errorMessage: result.errorMessage || null
    });
  }

  const report = {
    updatedAt: new Date().toISOString(),
    sites: results
  };

  await saveReport(report);
  log.info('poll finished', {
    updatedAt: report.updatedAt,
    siteCount: report.sites.length,
    downCount: report.sites.filter(item => item.status === 'down').length
  });
  return report;
}

// 启动定时轮询任务。
export function startPolling() {
  const intervalMs = Number(process.env.CHECK_INTERVAL_MS || 60000);
  const run = async () => {
    try {
      const report = await pollOnce();
      log.info('scheduled poll finished', {
        siteCount: report.sites.length,
        updatedAt: report.updatedAt
      });
    } catch (error) {
      log.error('scheduled poll failed', error);
    }
  };

  log.info('scheduled polling started', { intervalMs });
  void run();
  return setInterval(run, intervalMs);
}

// 导出当前内存中的最新站点状态。
export function getSnapshot() {
  return Array.from(state.values());
}
