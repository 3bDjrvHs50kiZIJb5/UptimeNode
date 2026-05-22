import dns from 'node:dns/promises';

// Cloudflare 橙云（代理）常用 IPv4 段
const CF_IPV4_CIDRS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22'
];

// Cloudflare 代理常用 IPv6 前缀（前缀匹配即可）
const CF_IPV6_PREFIXES = [
  '2400:cb00',
  '2606:4700',
  '2803:f800',
  '2405:b500',
  '2405:8100',
  '2a06:98c0',
  '2a06:98c1',
  '2c0f:f248'
];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((sum, part) => (sum << 8) + Number(part), 0) >>> 0;
}

function isIpv4InCidr(ip, cidr) {
  const [network, bitsText] = cidr.split('/');
  const bits = Number(bitsText);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

function isCloudflareIpv4(ip) {
  return CF_IPV4_CIDRS.some(cidr => isIpv4InCidr(ip, cidr));
}

function isCloudflareIpv6(ip) {
  const normalized = ip.toLowerCase();
  return CF_IPV6_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function isCloudflareIp(ip) {
  if (ip.includes(':')) {
    return isCloudflareIpv6(ip);
  }
  return isCloudflareIpv4(ip);
}

// 根据 HTTP 响应头判断是否经过 Cloudflare。
export function isCloudflareFromHeaders(headers = {}) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) {
    lower[String(key).toLowerCase()] = value;
  }
  if (lower['cf-ray']) {
    return true;
  }
  const server = String(lower.server || '');
  return /cloudflare/i.test(server);
}

// 解析域名 DNS，判断是否指向 Cloudflare（橙云典型特征）。
export async function resolveDnsPointsToCloudflare(hostname) {
  if (!hostname) {
    return { pointsToCloudflare: null, reason: '无主机名' };
  }

  try {
    const [ipv4List, ipv6List] = await Promise.all([
      dns.resolve4(hostname).catch(() => []),
      dns.resolve6(hostname).catch(() => [])
    ]);
    const ips = [...ipv4List, ...ipv6List];
    if (ips.length === 0) {
      return { pointsToCloudflare: null, reason: '无 DNS 记录' };
    }
    if (ips.some(isCloudflareIp)) {
      return { pointsToCloudflare: true, reason: 'DNS 指向 Cloudflare' };
    }
    return { pointsToCloudflare: false, reason: 'DNS 未指向 Cloudflare' };
  } catch (error) {
    return {
      pointsToCloudflare: null,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

// 综合 DNS 与响应头，得到橙云判断：true=是，false=否，null=未知。
export async function detectCloudflareProxied(hostname, headers = null) {
  const dnsResult = await resolveDnsPointsToCloudflare(hostname);
  const headerHit = headers ? isCloudflareFromHeaders(headers) : false;

  if (dnsResult.pointsToCloudflare === true || headerHit) {
    const reason = headerHit && dnsResult.pointsToCloudflare !== true
      ? '响应头含 Cloudflare 特征'
      : dnsResult.reason;
    return { cfProxied: true, cfProxiedReason: reason };
  }

  if (dnsResult.pointsToCloudflare === false) {
    return { cfProxied: false, cfProxiedReason: dnsResult.reason };
  }

  if (headerHit) {
    return { cfProxied: true, cfProxiedReason: '响应头含 Cloudflare 特征' };
  }

  return { cfProxied: null, cfProxiedReason: dnsResult.reason };
}
