const axios = require('axios');
const logger = require('../utils/logger');
const { validPath } = require('./musicGatewayService');
const forwardedHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
async function proxyMusicOutput(req, res, { gateway, authorize, client = axios }) {
  const path = req.query?.path;
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' });
  if (!validPath(path)) return res.status(400).send('Invalid music output path.');
  if (!await authorize(path)) return res.status(404).send('Music output not found.');
  const headers = {};
  for (const name of ['range', 'if-range']) {
    const value = req.get(name);
    if (value !== undefined) {
      if (typeof value !== 'string' || value.length > 256 || /[\r\n]/.test(value)) return res.status(400).send('Invalid playback headers.');
      headers[name] = value;
    }
  }
  const abort = new AbortController();
  let upstream;
  const disconnect = () => { abort.abort(); upstream?.destroy(); };
  res.once('close', disconnect);
  try {
    // Legacy alias is supported by both Gateway releases, including namespaced paths.
    const response = await client.request({ url: gateway.url('/music/acestep15/output'), method: req.method === 'HEAD' ? 'HEAD' : 'GET', params: { path }, headers, responseType: 'stream', timeout: 600000, maxRedirects: 0, signal: abort.signal, validateStatus: () => true });
    upstream = response.data;
    if (![200, 206, 304, 416].includes(response.status)) {
      upstream?.destroy();
      logger.warning('Music output proxy rejected Gateway response', { category: 'music', metadata: { status: response.status } });
      return res.status(response.status === 404 ? 404 : 502).send('Unable to fetch music output.');
    }
    res.status(response.status);
    for (const name of forwardedHeaders) if (response.headers[name] !== undefined) {
      // A 416 error body is deliberately not forwarded; keep its range metadata.
      if (response.status === 416 && ['content-type', 'content-length'].includes(name)) continue;
      res.setHeader(name, response.headers[name]);
    }
    if (req.method === 'HEAD' || [304, 416].includes(response.status)) { upstream?.destroy(); return res.end(); }
    upstream.once('error', () => {
      logger.warning('Music output stream interrupted', { category: 'music' });
      if (res.headersSent) res.destroy();
      else { res.removeHeader('Content-Length'); res.status(502).end(); }
    });
    upstream.once('end', () => res.removeListener('close', disconnect));
    if (res.destroyed) { disconnect(); return; }
    return upstream.pipe(res);
  } catch (error) {
    upstream?.destroy();
    if (!abort.signal.aborted) {
      logger.warning('Music output transport failed', { category: 'music', metadata: { status: error.response?.status || null } });
      if (res.headersSent) res.destroy();
      else res.status(502).send('Unable to fetch music output.');
    }
  } finally {
    if (!upstream || upstream.destroyed) res.removeListener('close', disconnect);
  }
}
module.exports = { proxyMusicOutput };
