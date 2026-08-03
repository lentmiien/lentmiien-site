const axios = require('axios');
const marked = require('marked');
const sanitizeHtml = require('sanitize-html');

const FALLBACK_GATEWAY_BASE_URL = 'http://192.168.0.20:8080';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_LIST_BYTES = 512 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const DOCUMENTATION_APP_PATH = '/admin/ai-gateway/documentation';

function normalizeHttpBaseUrl(rawValue, fallback = FALLBACK_GATEWAY_BASE_URL) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';

  try {
    const parsed = new URL(raw || fallback);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Unsupported URL');
    }

    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (error) {
    return fallback;
  }
}

function normalizeConfiguredGatewayBaseUrl(rawValue) {
  const normalized = normalizeHttpBaseUrl(rawValue, FALLBACK_GATEWAY_BASE_URL);

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    const isLocalhost = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname);
    if (isLocalhost && process.env.AI_GATEWAY_ALLOW_LOCALHOST !== 'true') {
      return FALLBACK_GATEWAY_BASE_URL;
    }
  } catch (error) {
    return FALLBACK_GATEWAY_BASE_URL;
  }

  return normalized;
}

const DEFAULT_GATEWAY_BASE_URL = normalizeConfiguredGatewayBaseUrl(process.env.AI_GATEWAY_BASE_URL);

function sanitizeDocumentationFileName(rawName) {
  if (typeof rawName !== 'string' || rawName.length === 0 || rawName.length > 255) {
    return null;
  }

  if (rawName !== rawName.trim() || rawName.includes('..')) {
    return null;
  }

  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.md$/i.test(rawName)) {
    return null;
  }

  return rawName;
}

function normalizeDocumentationList(payload) {
  if (!payload || !Array.isArray(payload.files)) {
    throw new Error('The AI Gateway returned an invalid documentation list.');
  }

  return Array.from(new Set(
    payload.files
      .map((fileName) => sanitizeDocumentationFileName(fileName))
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function extractDocumentationTitle(rawContent, fallbackName) {
  const headingMatch = String(rawContent || '').match(/^\s*#\s+(.+?)\s*$/m);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].trim();
  }

  return String(fallbackName || '').replace(/\.md$/i, '');
}

function slugifyHeading(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function addHeadingIds(html) {
  const seenIds = new Set();

  return String(html || '').replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (fullMatch, level, innerHtml) => {
    const headingText = sanitizeHtml(innerHtml, {
      allowedTags: [],
      allowedAttributes: {},
    }).trim();
    const baseId = slugifyHeading(headingText);

    if (!baseId) {
      return fullMatch;
    }

    let headingId = baseId;
    let suffix = 2;
    while (seenIds.has(headingId)) {
      headingId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(headingId);

    return `<h${level} id="${headingId}">${innerHtml}</h${level}>`;
  });
}

function transformDocumentationHref(href) {
  if (!href || /^(#|https?:|mailto:)/i.test(href)) {
    return href;
  }

  const match = String(href).match(/^(?:\.\/)?([^/#?]+\.md)(#[^?]*)?$/i);
  if (!match) {
    return href;
  }

  const fileName = sanitizeDocumentationFileName(match[1]);
  if (!fileName) {
    return href;
  }

  return `${DOCUMENTATION_APP_PATH}/${encodeURIComponent(fileName)}${match[2] || ''}`;
}

function renderDocumentationMarkdown(rawContent) {
  const rendered = marked.parse(String(rawContent || ''), { gfm: true });
  const cleaned = sanitizeHtml(rendered, {
    allowedTags: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5',
      'h6', 'hr', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody',
      'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      code: ['class'],
      img: ['src', 'alt', 'title', 'loading'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => {
        const safeHref = transformDocumentationHref(attribs.href);
        const nextAttribs = {
          ...attribs,
          href: safeHref,
        };

        if (/^(https?:|mailto:)/i.test(safeHref || '')) {
          nextAttribs.rel = 'noopener noreferrer nofollow';
          nextAttribs.target = '_blank';
        } else {
          delete nextAttribs.rel;
          delete nextAttribs.target;
        }

        return { tagName, attribs: nextAttribs };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          loading: 'lazy',
        },
      }),
    },
  });

  return addHeadingIds(cleaned);
}

function buildLocalhostBaseUrl(gatewayBaseUrl) {
  const parsed = new URL(normalizeHttpBaseUrl(gatewayBaseUrl));
  parsed.hostname = '127.0.0.1';
  return parsed.toString().replace(/\/+$/, '');
}

function buildDocumentationLinks({
  fileName,
  gatewayBaseUrl = DEFAULT_GATEWAY_BASE_URL,
  publicAppBaseUrl = 'https://my.lentmiien.com',
} = {}) {
  const safeFileName = sanitizeDocumentationFileName(fileName);
  if (!safeFileName) {
    throw new Error('A valid Markdown documentation filename is required.');
  }

  const safeGatewayBaseUrl = normalizeHttpBaseUrl(gatewayBaseUrl);
  const safePublicAppBaseUrl = normalizeHttpBaseUrl(publicAppBaseUrl, 'https://my.lentmiien.com');
  const gatewayPath = `/documentation/${encodeURIComponent(safeFileName)}`;
  const appPath = `${DOCUMENTATION_APP_PATH}/${encodeURIComponent(safeFileName)}`;

  return [
    {
      key: 'localhost',
      label: 'localhost',
      url: `${buildLocalhostBaseUrl(safeGatewayBaseUrl)}${gatewayPath}`,
    },
    {
      key: 'gateway',
      label: 'Gateway IP',
      url: `${safeGatewayBaseUrl}${gatewayPath}`,
    },
    {
      key: 'web-app',
      label: 'Web app',
      url: `${safePublicAppBaseUrl}${appPath}`,
    },
  ];
}

class AiGatewayDocumentationService {
  constructor({
    gatewayBaseUrl = DEFAULT_GATEWAY_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    httpClient = axios,
  } = {}) {
    this.gatewayBaseUrl = normalizeHttpBaseUrl(gatewayBaseUrl);
    this.timeoutMs = timeoutMs;
    this.httpClient = httpClient;
  }

  buildUrl(path) {
    return `${this.gatewayBaseUrl}${path}`;
  }

  async listFiles() {
    const response = await this.httpClient.get(this.buildUrl('/documentation'), {
      timeout: this.timeoutMs,
      responseType: 'json',
      maxContentLength: MAX_LIST_BYTES,
      headers: { Accept: 'application/json' },
    });

    return normalizeDocumentationList(response.data);
  }

  async fetchFile(fileName) {
    const safeFileName = sanitizeDocumentationFileName(fileName);
    if (!safeFileName) {
      throw new Error('Invalid AI Gateway documentation filename.');
    }

    const response = await this.httpClient.get(
      this.buildUrl(`/documentation/${encodeURIComponent(safeFileName)}`),
      {
        timeout: this.timeoutMs,
        responseType: 'text',
        maxContentLength: MAX_DOCUMENT_BYTES,
        headers: { Accept: 'text/markdown, text/plain;q=0.9' },
      },
    );

    if (typeof response.data === 'string') {
      return response.data;
    }
    if (Buffer.isBuffer(response.data)) {
      return response.data.toString('utf8');
    }

    throw new Error('The AI Gateway returned invalid Markdown content.');
  }
}

module.exports = {
  AiGatewayDocumentationService,
  DEFAULT_GATEWAY_BASE_URL,
  DOCUMENTATION_APP_PATH,
  buildDocumentationLinks,
  extractDocumentationTitle,
  normalizeDocumentationList,
  normalizeHttpBaseUrl,
  renderDocumentationMarkdown,
  sanitizeDocumentationFileName,
  transformDocumentationHref,
};
