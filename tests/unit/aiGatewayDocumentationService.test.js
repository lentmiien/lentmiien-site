const {
  AiGatewayDocumentationService,
  buildDocumentationLinks,
  extractDocumentationTitle,
  normalizeDocumentationList,
  renderDocumentationMarkdown,
  sanitizeDocumentationFileName,
} = require('../../services/aiGatewayDocumentationService');

describe('AI Gateway documentation service', () => {
  test.each([
    'ai-gateway.md',
    'qwen3-lora-gateway-usage.md',
    '_internal-guide.md',
  ])('accepts the safe Markdown filename %s', (fileName) => {
    expect(sanitizeDocumentationFileName(fileName)).toBe(fileName);
  });

  test.each([
    '../ai-gateway.md',
    'folder/ai-gateway.md',
    '.hidden.md',
    'guide.txt',
    'guide..md',
    ' guide.md',
    'guide with spaces.md',
  ])('rejects the unsafe documentation filename %s', (fileName) => {
    expect(sanitizeDocumentationFileName(fileName)).toBeNull();
  });

  test('normalizes, de-duplicates, filters, and sorts a Gateway file list', () => {
    expect(normalizeDocumentationList({
      files: [
        'guide-10.md',
        'guide-2.md',
        '../secret.md',
        'guide-2.md',
        null,
      ],
    })).toEqual(['guide-2.md', 'guide-10.md']);
  });

  test('rejects an invalid Gateway file-list response', () => {
    expect(() => normalizeDocumentationList({ files: 'guide.md' }))
      .toThrow('invalid documentation list');
  });

  test('fetches the documented list and Markdown response contracts', async () => {
    const httpClient = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { files: ['guide.md'] } })
        .mockResolvedValueOnce({ data: '# Gateway guide' }),
    };
    const service = new AiGatewayDocumentationService({
      gatewayBaseUrl: 'http://127.0.0.1:8080/',
      timeoutMs: 2500,
      httpClient,
    });

    await expect(service.listFiles()).resolves.toEqual(['guide.md']);
    await expect(service.fetchFile('guide.md')).resolves.toBe('# Gateway guide');

    expect(httpClient.get).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8080/documentation',
      expect.objectContaining({
        timeout: 2500,
        responseType: 'json',
        headers: { Accept: 'application/json' },
      }),
    );
    expect(httpClient.get).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8080/documentation/guide.md',
      expect.objectContaining({
        timeout: 2500,
        responseType: 'text',
        headers: { Accept: 'text/markdown, text/plain;q=0.9' },
      }),
    );
  });

  test('does not request an invalid filename', async () => {
    const httpClient = { get: jest.fn() };
    const service = new AiGatewayDocumentationService({ httpClient });

    await expect(service.fetchFile('../../secret.md')).rejects.toThrow('Invalid');
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  test('renders safe Markdown and routes relative guide links through the app', () => {
    const html = renderDocumentationMarkdown([
      '# Gateway guide',
      '',
      '[Next guide](next-guide.md#setup)',
      '',
      '[External](https://example.com/reference)',
      '',
      '<img src="https://example.com/image.png" onerror="alert(1)">',
      '<script>alert("unsafe")</script>',
      '[Unsafe](javascript:alert(1))',
    ].join('\n'));

    expect(html).toContain('<h1 id="gateway-guide">Gateway guide</h1>');
    expect(html).toContain('href="/admin/ai-gateway/documentation/next-guide.md#setup"');
    expect(html).toContain('href="https://example.com/reference"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toMatch(/<script|onerror=|href="javascript:/i);
  });

  test('generates unique heading anchors', () => {
    const html = renderDocumentationMarkdown('# Repeat\n\n## Repeat');
    expect(html).toContain('id="repeat"');
    expect(html).toContain('id="repeat-2"');
  });

  test('extracts the first H1 and falls back to the filename', () => {
    expect(extractDocumentationTitle('## Intro\n\n# Main guide', 'fallback.md')).toBe('Main guide');
    expect(extractDocumentationTitle('No title', 'fallback.md')).toBe('fallback');
  });

  test('builds localhost, Gateway IP, and protected Web app links', () => {
    expect(buildDocumentationLinks({
      fileName: 'ai-gateway.md',
      gatewayBaseUrl: 'http://192.168.0.20:8080',
      publicAppBaseUrl: 'https://my.lentmiien.com/',
    })).toEqual([
      {
        key: 'localhost',
        label: 'localhost',
        url: 'http://127.0.0.1:8080/documentation/ai-gateway.md',
      },
      {
        key: 'gateway',
        label: 'Gateway IP',
        url: 'http://192.168.0.20:8080/documentation/ai-gateway.md',
      },
      {
        key: 'web-app',
        label: 'Web app',
        url: 'https://my.lentmiien.com/admin/ai-gateway/documentation/ai-gateway.md',
      },
    ]);
  });
});
