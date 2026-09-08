const axios = require('axios');
const logger = require('../utils/logger');
let cached;
let expires = 0;
let pending;
async function getStatus() {
  if (cached && Date.now() < expires) return cached;
  if (pending) return pending;
  pending = (async () => {
    let base;
    try {
      base = new URL(process.env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080');
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('config');
    } catch (_) { return { state: 'unavailable', rows: [], note: 'Gateway configuration unavailable.' }; }
    const results = await Promise.allSettled(['/gpu', '/gpu/reservation', '/containers'].map(path => axios.get(new URL(path, base).href, {
      timeout: 4000, maxRedirects: 0, maxContentLength: 256 * 1024,
      headers: path === '/containers' && process.env.LLM_ADMIN_TOKEN ? { 'X-Admin-Token': process.env.LLM_ADMIN_TOKEN } : {},
    })));
    const at = new Date().toISOString();
    const rows = [];
    const gpu = results[0].status === 'fulfilled' ? results[0].value.data : null;
    const current = gpu?.now || gpu;
    if (current) rows.push({ title: 'GPU', detail: `${Number.isFinite(current.gpu_busy_percent) ? current.gpu_busy_percent + '% busy' : 'Utilization unknown'} · ${Number.isFinite(current.temp_c) ? current.temp_c + ' °C' : 'Temperature unknown'}`, href: '/admin/ai-gateway', at });
    const raw = results[1].status === 'fulfilled' ? results[1].value.data : null;
    const reservation = raw?.reservation || raw;
    if (reservation) rows.push({ title: 'Reservation', detail: reservation.active === true ? 'Active' : reservation.active === false ? 'Available' : 'Unknown', href: '/admin/ai-gateway', at });
    if (results[2].status === 'fulfilled') {
      const rawContainers = results[2].value.data;
      const containers = Array.isArray(rawContainers) ? rawContainers : rawContainers?.containers;
      rows.push({ title: 'Containers', detail: Array.isArray(containers) ? `${containers.length} tracked · open gateway for details` : 'Status endpoint reachable · open gateway for details', href: '/admin/ai-gateway', at });
    }
    const failed = results.some(r => r.status === 'rejected');
    if (failed) logger.warning('Dashboard gateway status partially unavailable', { category: 'account_dashboard' });
    cached = { rows, state: failed ? 'stale' : 'ready', note: 'Explicit status check · shared cache for 30 seconds. No workloads started.' };
    expires = Date.now() + 30000;
    return cached;
  })();
  try { return await pending; } finally { pending = null; }
}
module.exports = { getStatus };
