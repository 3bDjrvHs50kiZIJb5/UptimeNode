import './env.js';
import { isDevMode, isTelegramEnabled } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('telegram');

// 转义 Telegram 文本中的 HTML 特殊字符，避免消息格式被破坏。
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// 读取 Telegram Bot Token。
function getTelegramToken() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

// 读取默认的 Telegram 聊天 ID。
function getTelegramChatId() {
  return process.env.TELEGRAM_CHAT_ID || '';
}

// 组装 Telegram API 请求地址。
function buildTelegramApiUrl(method) {
  return `https://api.telegram.org/bot${getTelegramToken()}/${method}`;
}

// 向 Telegram 发送一条消息，可指定目标聊天和回复消息。
export async function sendTelegramMessage(message, options = {}) {
  try {
    const token = getTelegramToken();
    const defaultChatId = getTelegramChatId();
    const enabled = isTelegramEnabled();
    const chatId = String(options.chatId || defaultChatId || '').trim();

    if (!enabled || !token || !chatId) {
      log.warn('telegram send skipped', {
        enabled,
        hasToken: Boolean(token),
        hasChatId: Boolean(chatId)
      });
      return false;
    }

    const response = await fetch(buildTelegramApiUrl('sendMessage'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: new URLSearchParams({
        chat_id: chatId,
        text: message,
        parse_mode: options.parseMode || 'HTML',
        disable_web_page_preview: options.disableWebPagePreview === false ? 'false' : 'true',
        ...(options.replyToMessageId ? { reply_to_message_id: String(options.replyToMessageId) } : {})
      })
    });

    log[response.ok ? 'info' : 'warn']('telegram send finished', {
      ok: response.ok,
      status: response.status,
      chatId
    });
    return response.ok;
  } catch (error) {
    log.error('telegram send failed', error);
    return false;
  }
}

// 统一命令文本格式，方便后续匹配。
function normalizeCommandText(text) {
  return String(text || '').trim().toLowerCase();
}

// 提取 Telegram 消息里的命令名。
function getCommandName(text) {
  const firstToken = normalizeCommandText(text).split(/\s+/)[0] || '';
  if (!firstToken.startsWith('/')) {
    return firstToken;
  }

  const command = firstToken.slice(1);
  return command.split('@')[0];
}

// 生成帮助说明文案。
function buildHelpMessage() {
  return [
    '🤖 <b>UptimeGuard 监控机器人</b>',
    '',
    '可用命令：',
    '• <code>id</code> 或 <code>/id</code>：查看当前聊天信息',
    '• <code>help</code> 或 <code>/help</code>：查看帮助',
    '',
    '提示：如果在群里想直接发送普通文本 <code>id</code>，需要关闭 Bot 的隐私模式；否则请用 <code>/id</code>。'
  ].join('\n');
}

// 生成聊天信息回复文案。
function buildChatInfoMessage(message) {
  const chat = message?.chat || {};
  const from = message?.from || {};
  const displayName = from.first_name || from.last_name || chat.title || '用户';
  const username = from.username ? `@${from.username}` : '未设置';

  return [
    `👋 你好 ${escapeHtml(displayName)}！`,
    '',
    '🤖 我是 UptimeGuard 监控机器人。',
    '',
    '📊 你的聊天信息：',
    `• 聊天 ID: ${escapeHtml(chat.id ?? '-')}`,
    `• 用户名: ${escapeHtml(username)}`
  ].join('\n');
}

// 根据命令内容返回对应的 Telegram 回复。
async function replyToTelegramCommand(message) {
  const command = getCommandName(message.text);
  if (command === 'id') {
    return sendTelegramMessage(buildChatInfoMessage(message), {
      chatId: message?.chat?.id,
      replyToMessageId: message.message_id
    });
  }

  if (command === 'help' || command === 'start') {
    return sendTelegramMessage(buildHelpMessage(), {
      chatId: message?.chat?.id,
      replyToMessageId: message.message_id
    });
  }

  return false;
}

// 轮询 Telegram 最新消息。
async function pollTelegramUpdates(offset) {
  const response = await fetch(buildTelegramApiUrl('getUpdates'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: new URLSearchParams({
      offset: String(offset),
      timeout: '25',
      allowed_updates: JSON.stringify(['message'])
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data?.result) ? data.result : [];
}

// 启动 Telegram 命令轮询任务。
export function startTelegramCommandPolling() {
  const enabled = isTelegramEnabled();
  const token = getTelegramToken();

  if (!enabled || !token) {
    log.info('telegram command polling disabled', {
      enabled,
      devMode: isDevMode(),
      hasToken: Boolean(token)
    });
    return {
      stop() {}
    };
  }

  const intervalMs = Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 5000);
  let stopped = false;
  let inFlight = false;
  let offset = 0;
  let timer = null;

  const runOnce = async () => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;
    try {
      const updates = await pollTelegramUpdates(offset);
      log.debug('telegram updates fetched', { count: updates.length, offset });
      for (const update of updates) {
        if (typeof update?.update_id === 'number') {
          offset = update.update_id + 1;
        }

        const message = update?.message;
        if (!message || typeof message.text !== 'string') {
          continue;
        }

        const command = getCommandName(message.text);
        if (command === 'id' || command === 'help' || command === 'start') {
          log.info('telegram command received', {
            command,
            chatId: message?.chat?.id,
            messageId: message?.message_id
          });
          await replyToTelegramCommand(message);
        }
      }
    } catch (error) {
      console.error('[telegram] command polling failed:', error);
      log.error('telegram command polling failed', error);
    } finally {
      inFlight = false;
      if (!stopped) {
        timer = setTimeout(runOnce, intervalMs);
      }
    }
  };

  timer = setTimeout(runOnce, 0);
  log.info('telegram command polling started', { intervalMs });

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      log.info('telegram command polling stopped');
    }
  };
}

// 生成站点宕机告警内容。
export function formatSiteDownMessage(site, result) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return [
    '🚨 <b>网站监控警报</b>',
    '',
    `📊 <b>网站信息:</b>`,
    `• 名称: ${site.name}`,
    `• URL: ${site.url}`,
    `• 连续失败: ${result.consecutiveFailures}/${result.failureThreshold || 10} 次`,
    '',
    `⏰ <b>检测时间:</b> ${timestamp}`,
    '',
    '⚠️ <b>状态:</b> 网站不可访问'
  ].join('\n');
}

// 生成站点恢复通知内容。
export function formatSiteRecoveryMessage(site, result) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return [
    '✅ <b>网站恢复通知</b>',
    '',
    `📊 <b>网站信息:</b>`,
    `• 名称: ${site.name}`,
    `• URL: ${site.url}`,
    `• 响应延迟: ${result.latencyMs} ms`,
    '',
    `⏰ <b>恢复时间:</b> ${timestamp}`,
    '',
    '🎉 <b>状态:</b> 网站已恢复正常访问'
  ].join('\n');
}

// 生成 SSL 即将到期提醒内容。
export function formatSslExpiryMessage(site, result) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const policy = result.sslDaysLeft < 2 ? '剩余不足 2 天：每小时最多提醒一次' : '剩余 2～7 天：每个自然日最多提醒一次';
  return [
    '🔐 <b>SSL 证书即将到期</b>',
    '',
    `📊 <b>网站信息:</b>`,
    `• 名称: ${site.name}`,
    `• URL: ${site.url}`,
    `• 证书剩余约: <b>${result.sslDaysLeft} 天</b>（约 ${result.sslHoursLeft.toFixed(1)} 小时）`,
    '',
    `📌 <b>提醒策略:</b> ${policy}`,
    '',
    `⏰ <b>检测时间:</b> ${timestamp}`,
    '',
    '⚠️ 请尽快续期或更换 SSL 证书。'
  ].join('\n');
}
