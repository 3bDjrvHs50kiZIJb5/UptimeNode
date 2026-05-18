import './env.js';
export async function sendTelegramMessage(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  const enabled = process.env.TELEGRAM_ENABLED !== 'false';

  if (!enabled || !token || !chatId) {
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: new URLSearchParams({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: 'true'
    })
  });

  return response.ok;
}

export function formatSiteDownMessage(site, result) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return [
    '🚨 <b>网站监控警报</b>',
    '',
    `📊 <b>网站信息:</b>`,
    `• 名称: ${site.name}`,
    `• URL: ${site.url}`,
    `• 连续失败: ${result.consecutiveFailures} 次`,
    '',
    `⏰ <b>检测时间:</b> ${timestamp}`,
    '',
    '⚠️ <b>状态:</b> 网站不可访问'
  ].join('\n');
}

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
