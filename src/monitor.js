import './env.js';
import https from 'node:https';
import tls from 'node:tls';
import { loadSites, saveReport } from './storage.js';
import { sendTelegramMessage, formatSiteDownMessage, formatSiteRecoveryMessage, formatSslExpiryMessage } from './notifier.js';
import { sendEmail, formatSiteDownEmail, formatSiteRecoveryEmail } from './email.js';

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const state = new Map();

function normalizeUrl(input) {
  return String(input || '').trim();
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function secondsToDays(seconds) {
  return Math.floor(seconds / 86400);
}

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

async function checkSite(site, config) {
  const url = normalizeUrl(site.url);
  const sslResult = await checkSslCertificate(url, config.sslCheckTimeoutMs);

  try {
    const response = await fetchWithTimeout(url, config.requestTimeoutMs);
    const keywordResult = evaluateKeywords(response.body, site.keywords || []);
    const status = response.ok && (keywordResult.keywordEnabled ? keywordResult.keywordMatched : true) ? 'up' : 'down';
    const errorMessage = response.ok
      ? (keywordResult.keywordEnabled && !keywordResult.keywordMatched ? '页面未包含指定关键字' : null)
      : `HTTP ${response.status}`;

    return {
      name: site.name,
      url,
      status,
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
      checkedAt: new Date().toISOString(),
      consecutiveFailures: 0
    };
  } catch (error) {
    return {
      name: site.name,
      url,
      status: 'down',
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
      checkedAt: new Date().toISOString(),
      consecutiveFailures: 0
    };
  }
}

async function handleAlerts(site, result, previousState) {
  const isDown = result.status === 'down';
  const wasDown = previousState?.status === 'down';
  const failureThreshold = Number(process.env.FAILURE_THRESHOLD || 3);
  const emailFailureThreshold = Number(process.env.EMAIL_FAILURE_THRESHOLD || 10);

  if (isDown) {
    const nextFailures = (previousState?.consecutiveFailures || 0) + 1;
    result.consecutiveFailures = nextFailures;

    if (nextFailures >= failureThreshold && !wasDown) {
      await sendTelegramMessage(formatSiteDownMessage(site, result));
    }

    if (nextFailures >= emailFailureThreshold && previousState?.emailAlertSent !== true) {
      const email = formatSiteDownEmail(site, result);
      const ok = await sendEmail({
        to: process.env.EMAIL_TO || '',
        subject: email.subject,
        text: email.text,
        html: email.html
      });
      if (ok) {
        result.emailAlertSent = true;
      }
    }
  } else {
    result.consecutiveFailures = 0;
    result.emailAlertSent = false;
    if (wasDown) {
      await sendTelegramMessage(formatSiteRecoveryMessage(site, result));
      const email = formatSiteRecoveryEmail(site, result);
      await sendEmail({
        to: process.env.EMAIL_TO || '',
        subject: email.subject,
        text: email.text,
        html: email.html
      });
    }
  }

  if (result.sslStatus === 'up' && typeof result.sslDaysLeft === 'number') {
    if (result.sslDaysLeft <= 7) {
      const lastAlertAt = previousState?.sslLastAlertAt || 0;
      const shouldSend = result.sslDaysLeft < 2
        ? lastAlertAt === 0 || Date.now() - lastAlertAt >= 3600000
        : lastAlertAt === 0 || new Date(lastAlertAt).toDateString() !== new Date().toDateString();

      if (shouldSend) {
        await sendTelegramMessage(formatSslExpiryMessage(site, result));
        result.sslLastAlertAt = Date.now();
      } else {
        result.sslLastAlertAt = lastAlertAt;
      }
    }
  }
}

export async function pollOnce() {
  const config = {
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10000),
    sslCheckTimeoutMs: Number(process.env.SSL_CHECK_TIMEOUT_MS || 10000),
    failureThreshold: Number(process.env.FAILURE_THRESHOLD || 3)
  };

  const sites = await loadSites();
  const results = [];

  for (const site of sites) {
    const previousState = state.get(site.url) || null;
    const result = await checkSite(site, config);
    result.consecutiveFailures = previousState?.consecutiveFailures || 0;
    result.sslLastAlertAt = previousState?.sslLastAlertAt || 0;
    result.emailAlertSent = previousState?.emailAlertSent || false;
    await handleAlerts(site, result, previousState);
    state.set(site.url, result);
    results.push(result);
  }

  const report = {
    updatedAt: new Date().toISOString(),
    sites: results
  };

  await saveReport(report);
  return report;
}

export function startPolling() {
  const intervalMs = Number(process.env.CHECK_INTERVAL_MS || 60000);
  const run = async () => {
    try {
      const report = await pollOnce();
      console.log(`[monitor] checked ${report.sites.length} sites at ${report.updatedAt}`);
    } catch (error) {
      console.error('[monitor] polling failed:', error);
    }
  };

  void run();
  return setInterval(run, intervalMs);
}

export function getSnapshot() {
  return Array.from(state.values());
}
