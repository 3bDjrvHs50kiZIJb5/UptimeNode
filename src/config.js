import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rootDir = path.resolve(__dirname, '..');
export const publicDir = path.join(rootDir, 'public');
export const dataDir = path.join(rootDir, 'data');
export const logsDir = path.join(rootDir, 'logs');
export const sitesFile = path.join(dataDir, 'sites.json');
export const reportFile = path.join(dataDir, 'report.json');
export const logFile = path.join(logsDir, 'uptime.log');

// 是否为本地调试模式（npm run dev 会设置 UPTIME_DEV=1）。
export function isDevMode() {
  const flag = String(process.env.UPTIME_DEV || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

// Telegram 是否启用（开发模式强制关闭）。
export function isTelegramEnabled() {
  if (isDevMode()) {
    return false;
  }
  return process.env.TELEGRAM_ENABLED !== 'false';
}

export const defaultConfig = {
  checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS || 60_000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10_000),
  sslCheckTimeoutMs: Number(process.env.SSL_CHECK_TIMEOUT_MS || 10_000),
  failureThreshold: Number(process.env.FAILURE_THRESHOLD || 10),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  telegramEnabled: isTelegramEnabled(),
  emailApiUrl: process.env.EMAIL_API_URL || '',
  emailApiKey: process.env.EMAIL_API_KEY || '',
  emailTo: process.env.EMAIL_TO || '',
  pagePassword: process.env.PAGE_PASSWORD || ''
};
