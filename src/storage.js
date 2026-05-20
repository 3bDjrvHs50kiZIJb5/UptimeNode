import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, sitesFile, reportFile } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('storage');

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    return data;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function ensureStorage() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.dirname(reportFile), { recursive: true });
  const sites = await readJson(sitesFile, null);
  if (!Array.isArray(sites)) {
    await writeJson(sitesFile, []);
    log.info('created default sites file', { sitesFile });
  }
}

export async function loadSites() {
  await ensureStorage();
  const sites = await readJson(sitesFile, []);
  return Array.isArray(sites) ? sites : [];
}

export async function saveSites(sites) {
  await writeJson(sitesFile, sites);
  log.info('saved sites', { count: Array.isArray(sites) ? sites.length : 0 });
  return sites;
}

export async function upsertSite(site) {
  const sites = await loadSites();
  const normalized = {
    name: String(site.name || '').trim(),
    url: String(site.url || '').trim(),
    keywords: Array.isArray(site.keywords) ? site.keywords.map(keyword => String(keyword).trim()).filter(Boolean) : []
  };
  const index = sites.findIndex(item => item.url === normalized.url);
  if (index >= 0) {
    sites[index] = normalized;
  } else {
    sites.push(normalized);
  }
  await saveSites(sites);
  log.info('upserted site', { name: normalized.name, url: normalized.url, keywordCount: normalized.keywords.length });
  return sites;
}

export async function saveReport(report) {
  await writeJson(reportFile, report);
  log.debug('saved report', { updatedAt: report?.updatedAt, siteCount: Array.isArray(report?.sites) ? report.sites.length : 0 });
}

export async function loadReport() {
  return await readJson(reportFile, { updatedAt: null, sites: [] });
}
