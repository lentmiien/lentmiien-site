const zlib = require('zlib');
const { strictJson } = require('../../utils/taricProtocol');
const { gcode, TaricError } = require('../../utils/taricContracts');
const LIMIT = 262144;
// Infrastructure-only export for loopback tests. The IPC entrypoint accepts ONLY a
// validated item code plus parent-owned CA-file path; never a client URL, proxy or headers.
async function nativeBody(url, headers, caPath, { maxBytes = LIMIT, timeoutMs = 13000 } = {}) {
  let library;
  try { library = require('curl-cffi'); } catch (_) { throw new TaricError('FETCH_DISABLED'); }
  const { Curl, CurlOpt, CurlInfo, libVersion } = library;
  // This packaged libcurl version's MAXFILESIZE_LARGE was exercised against
  // chunked/no-length bodies. Older libcurl may check only Content-Length.
  if (!/^libcurl\/8\.15\.0-IMPERSONATE\b/.test(libVersion())) throw new TaricError('FETCH_DISABLED');
  const curl = new Curl(); curl.init();
  let phase = 'connect'; let status = null;
  try {
    curl.impersonate('chrome136', true);
    curl.setOption(CurlOpt.Url, url.href);
    curl.setOption(CurlOpt.FollowLocation, false);
    curl.setOption(CurlOpt.MaxRedirs, 0);
    curl.setOption(CurlOpt.TimeoutMs, timeoutMs);
    curl.setOption(CurlOpt.ConnectTimeoutMs, Math.min(5000, timeoutMs));
    curl.setOption(CurlOpt.MaxFileSizeLarge, maxBytes);
    // Disable native decompression so its buffered body is WIRE-bounded even for
    // compressed bombs. Decode below with a separately enforced output limit.
    curl.setOption(CurlOpt.HttpContentDecoding, false);
    curl.setOption(CurlOpt.SslVerifyPeer, 1); curl.setOption(CurlOpt.SslVerifyHost, 2);
    curl.setOption(CurlOpt.ProxySslVerifyPeer, 1); curl.setOption(CurlOpt.ProxySslVerifyHost, 2);
    if (caPath) { curl.setOption(CurlOpt.CaInfo, caPath); curl.setOption(CurlOpt.ProxyCaInfo, caPath); }
    curl.setOption(CurlOpt.FailOnError, true);
    curl.setHeadersRaw(Object.entries(headers).map(([key, value]) => `${key}: ${value}`));
    await curl.perform();
    status = curl.getInfoNumber(CurlInfo.ResponseCode); phase = 'http';
    if (status !== 200) throw new Error('HTTP rejected');
    const rawHeaders = curl.getRespHeaders().toString('utf8').trim().split(/\r?\n\r?\n/).at(-1);
    const responseHeaders = {};
    for (const line of rawHeaders.split(/\r?\n/).slice(1)) {
      const colon = line.indexOf(':'); if (colon > 0) responseHeaders[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
    }
    if (!/^application\/json(?:\s*;|$)/i.test(responseHeaders['content-type'] || '')) { phase = 'envelope'; throw new Error('Not JSON'); }
    const bytes = curl.getRespBody();
    if (bytes.length > maxBytes) { phase = 'limit'; throw new Error('Limit'); }
    return { bytes, encoding: (responseHeaders['content-encoding'] || 'identity').toLowerCase() };
  } catch (cause) {
    status = curl.getInfoNumber(CurlInfo.ResponseCode) || status;
    // Only allowlisted numeric curl error classification, never return the native
    // error text (may contain host, proxy, certificate path, or response details).
    const code = /^failed with code: (\d+)\b/.exec(cause.message || '')?.[1];
    if (code === '60') phase = 'tls';
    else if (code === '63') phase = 'limit';
    else if (code === '28') phase = 'timeout';
    else if (code === '6') phase = 'dns';
    else if (status && phase === 'connect') phase = 'http';
    const error = new TaricError(status === 403 ? 'HTTP_ACCESS_DENIED' : code === '60' ? 'TLS_CHAIN_UNTRUSTED' : 'FETCH_FAILED');
    error.transport = { phase, dispatched: !['dns', 'tls', 'connect'].includes(phase), terminal: phase === 'http', ...(status ? { status } : {}) };
    throw error;
  } finally { curl.close(); }
}
function decode({ bytes, encoding }, maxBytes = LIMIT) {
  const decoders = { gzip: zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync, zstd: zlib.zstdDecompressSync };
  if (encoding !== 'identity' && !decoders[encoding]) throw new TaricError('FETCH_FAILED');
  const decoded = encoding === 'identity' ? bytes : decoders[encoding](bytes, { maxOutputLength: maxBytes });
  if (decoded.length > maxBytes) throw new TaricError('FETCH_FAILED');
  return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(decoded), 'FETCH_FAILED');
}
async function fetchItem(code, caPath) {
  gcode(code);
  const url = new URL('https://api.amiami.com/api/v1.0/item');
  url.searchParams.set('gcode', code); url.searchParams.set('lang', 'eng');
  return decode(await nativeBody(url, {
    Accept: 'application/json,text/plain,*/*', 'Accept-Encoding': 'gzip, deflate, br, zstd',
    'X-User-Key': 'amiami_dev', 'Accept-Language': 'en-US,en;q=0.9',
    Referer: `https://www.amiami.com/eng/detail?gcode=${code}`,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  }, caPath));
}
if (require.main === module) {
  process.once('message', async message => {
    let result;
    try { result = { ok: true, data: await fetchItem(message?.code, message?.caPath) }; }
    catch (error) { result = { ok: false, code: error instanceof TaricError ? error.code : 'FETCH_FAILED', transport: error.transport }; }
    process.send(result, () => process.exit(0));
  });
}
module.exports = { nativeBody, decode, fetchItem };
