import './env.js';
import { createLogger } from './logger.js';

const log = createLogger('email');

export async function sendEmail(payload) {
  try {
    const endpoint = process.env.EMAIL_API_URL || '';
    const apiKey = process.env.EMAIL_API_KEY || '';

    if (!endpoint || !apiKey) {
      log.warn('email config missing, skipping send');
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

    log[response.ok ? 'info' : 'warn']('email send finished', {
      ok: response.ok,
      status: response.status,
      to: payload?.to || ''
    });
    return response.ok;
  } catch (error) {
    log.error('email send failed', error);
    return false;
  }
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

export function formatSslExpiryEmail(site, result) {
  const subject = `SSL 证书即将到期：${site.name}`;
  const text = [
    `站点名称：${site.name}`,
    `站点地址：${site.url}`,
    `证书剩余约：${result.sslDaysLeft} 天（约 ${Number(result.sslHoursLeft || 0).toFixed(1)} 小时）`,
    `提醒策略：${result.sslDaysLeft < 2 ? '剩余不足 2 天：每小时最多提醒一次' : '剩余 2～7 天：每个自然日最多提醒一次'}`,
    `最近错误：${result.sslError || result.errorMessage || '-'}`
  ].join('\n');

  const html = [
    '<h3>SSL 证书即将到期</h3>',
    `<p><b>站点名称：</b>${site.name}</p>`,
    `<p><b>站点地址：</b>${site.url}</p>`,
    `<p><b>证书剩余约：</b>${result.sslDaysLeft} 天（约 ${Number(result.sslHoursLeft || 0).toFixed(1)} 小时）</p>`,
    `<p><b>提醒策略：</b>${result.sslDaysLeft < 2 ? '剩余不足 2 天：每小时最多提醒一次' : '剩余 2～7 天：每个自然日最多提醒一次'}</p>`,
    `<p><b>最近错误：</b>${result.sslError || result.errorMessage || '-'}</p>`
  ].join('');

  return { subject, text, html };
}
