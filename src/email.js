import './env.js';
export async function sendEmail(payload) {
  const endpoint = process.env.EMAIL_API_URL || '';
  const apiKey = process.env.EMAIL_API_KEY || '';

  if (!endpoint || !apiKey) {
    return false;
  }

  const body = {
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(body)
  });

  return response.ok;
}

export function formatSiteDownEmail(site, result) {
  const subject = `站点连续失败警报：${site.name}`;
  const text = [
    `站点名称：${site.name}`,
    `站点地址：${site.url}`,
    `当前状态：${result.status}`,
    `HTTP 状态：${result.httpStatus}`,
    `响应时间：${result.latencyMs} ms`,
    `连续失败：${result.consecutiveFailures} 次`,
    `最近错误：${result.errorMessage || '-'}`
  ].join('\n');

  const html = [
    '<h3>站点连续失败警报</h3>',
    `<p><b>站点名称：</b>${site.name}</p>`,
    `<p><b>站点地址：</b>${site.url}</p>`,
    `<p><b>当前状态：</b>${result.status}</p>`,
    `<p><b>HTTP 状态：</b>${result.httpStatus}</p>`,
    `<p><b>响应时间：</b>${result.latencyMs} ms</p>`,
    `<p><b>连续失败：</b>${result.consecutiveFailures} 次</p>`,
    `<p><b>最近错误：</b>${result.errorMessage || '-'}</p>`
  ].join('');

  return { subject, text, html };
}

export function formatSiteRecoveryEmail(site, result) {
  const subject = `站点恢复正常：${site.name}`;
  const text = [
    `站点名称：${site.name}`,
    `站点地址：${site.url}`,
    `当前状态：${result.status}`,
    `HTTP 状态：${result.httpStatus}`,
    `响应时间：${result.latencyMs} ms`,
    `最近错误：${result.errorMessage || '-'}`
  ].join('\n');

  const html = [
    '<h3>站点恢复正常通知</h3>',
    `<p><b>站点名称：</b>${site.name}</p>`,
    `<p><b>站点地址：</b>${site.url}</p>`,
    `<p><b>当前状态：</b>${result.status}</p>`,
    `<p><b>HTTP 状态：</b>${result.httpStatus}</p>`,
    `<p><b>响应时间：</b>${result.latencyMs} ms</p>`,
    `<p><b>最近错误：</b>${result.errorMessage || '-'}</p>`
  ].join('');

  return { subject, text, html };
}
