import fs from 'node:fs/promises';
import path from 'node:path';
import { logsDir } from './config.js';

const retentionDays = 10;
let writeQueue = Promise.resolve();
let lastCleanupKey = '';

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateParts(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-');
}

function formatTimestamp(date = new Date()) {
  return [
    formatDateParts(date),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(' ') + `.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function getLogFilePath(date = new Date()) {
  return path.join(logsDir, `${formatDateParts(date)}.log`);
}

function formatMeta(meta) {
  if (meta == null) {
    return '';
  }

  if (meta instanceof Error) {
    return `${meta.name}: ${meta.message}${meta.stack ? `\n${meta.stack}` : ''}`;
  }

  if (typeof meta === 'string') {
    return meta;
  }

  try {
    return JSON.stringify(meta, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }

      if (typeof value === 'bigint') {
        return value.toString();
      }

      return value;
    });
  } catch {
    return String(meta);
  }
}

function buildLine(level, scope, message, meta) {
  const parts = [
    `[${formatTimestamp()}]`,
    `[${String(level || 'INFO').toUpperCase()}]`,
    `[${scope}]`,
    message
  ];

  const metaText = formatMeta(meta);
  if (metaText) {
    parts.push(`| ${metaText}`);
  }

  return parts.join(' ');
}

async function pruneOldLogs() {
  const todayKey = formatDateParts(new Date());
  if (lastCleanupKey === todayKey) {
    return;
  }

  lastCleanupKey = todayKey;

  const entries = await fs.readdir(logsDir, { withFileTypes: true });
  const threshold = new Date();
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - (retentionDays - 1));
  const thresholdKey = formatDateParts(threshold);

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) {
      continue;
    }

    const fileDateKey = entry.name.slice(0, 10);
    if (fileDateKey < thresholdKey) {
      await fs.unlink(path.join(logsDir, entry.name)).catch(() => {});
    }
  }
}

async function writeLine(line) {
  await fs.mkdir(logsDir, { recursive: true });
  await pruneOldLogs();
  await fs.appendFile(getLogFilePath(), `${line}\n`, 'utf8');
}

function enqueueWrite(line) {
  writeQueue = writeQueue
    .then(() => writeLine(line))
    .catch(error => {
      console.error('[logger] write failed:', error);
    });
  return writeQueue;
}

function emit(level, scope, message, meta) {
  const line = buildLine(level, scope, message, meta);
  const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[consoleMethod](line);
  return enqueueWrite(line);
}

export function createLogger(scope) {
  return {
    debug(message, meta) {
      return emit('debug', scope, message, meta);
    },
    info(message, meta) {
      return emit('info', scope, message, meta);
    },
    warn(message, meta) {
      return emit('warn', scope, message, meta);
    },
    error(message, meta) {
      return emit('error', scope, message, meta);
    }
  };
}

export const logger = createLogger('app');
