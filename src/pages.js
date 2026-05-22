import fs from 'node:fs/promises';
import path from 'node:path';
import { publicDir } from './config.js';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

const cache = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function readPublicFile(relativePath) {
  if (!cache.has(relativePath)) {
    const fullPath = path.join(publicDir, relativePath);
    cache.set(relativePath, await fs.readFile(fullPath, 'utf8'));
  }
  return cache.get(relativePath);
}

// 解析 /assets/* 对应的 public 内相对路径，并阻止目录穿越。
export function resolvePublicAsset(pathname) {
  if (!pathname.startsWith('/assets/')) {
    return null;
  }
  const relativePath = pathname.slice('/assets/'.length);
  if (!relativePath || relativePath.includes('..')) {
    return null;
  }
  return relativePath;
}

export async function readPublicAsset(relativePath) {
  const ext = path.extname(relativePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const body = await readPublicFile(relativePath);
  return { body, contentType };
}

export async function renderLoginPage(message = '') {
  const template = await readPublicFile('login.html');
  return template.replaceAll('{{MESSAGE}}', escapeHtml(message));
}

export async function renderDashboardPage() {
  return readPublicFile('dashboard.html');
}
