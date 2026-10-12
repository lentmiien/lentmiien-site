const express = require('express');
const expressStaticGzip = require('express-static-gzip');
const http = require('http');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { guardStaticMedia } = require('../../services/gptImageStorageService');

// Exercise the same public static middleware as app.js without starting its DB,
// schedulers, setup pipeline, or any production application service.
describe('Friendly Monsters public static delivery', () => {
  let server, port;
  beforeAll(async () => {
    const app = express();
    const root = path.resolve(__dirname, '../..');
    app.set('views', path.join(root, 'views')); app.set('view engine', 'pug'); app.locals.loggedIn = false;
    // Execute the actual discovery/mount/Games route block, without app startup or DB imports.
    const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const start = source.indexOf('const gamesDirectory =');
    const end = source.indexOf('// -----------------', start);
    if (start < 0 || end < start) throw new Error('Games route block not found');
    vm.runInNewContext(source.slice(start, end), {
      fs, path, __dirname: root, app,
      imageSafeStaticGzip: (directory, options) => guardStaticMedia(directory, expressStaticGzip(directory, options)),
    });
    app.use((req, res) => res.status(404).send('Not found'));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    port = server.address().port;
  });
  afterAll(() => new Promise(resolve => server.close(resolve)));
  function request(url, method = 'GET', headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      }); req.on('error', reject); req.end();
    });
  }
  test('actual app discovery renders the Japanese Games entry and canonical link', async () => {
    const response = await request('/games');
    expect(response.status).toBe(200);
    expect(response.body).toContain('href="/games/friendly-monsters/"');
    expect(response.body).toContain('ともだちと、とんでもない幸運 · Friendly Monsters');
  });
  test.each(['/friendly-monsters', '/games/friendly-monsters'])('redirects %s to the slash required by relative assets', async url => {
    const response = await request(url);
    expect(response.status).toBe(301); expect(response.headers.location).toBe(url + '/');
  });
  test.each(['/friendly-monsters/', '/games/friendly-monsters/'])('anonymous read works at %s', async url => {
    const response = await request(url);
    expect(response.status).toBe(200); expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('ともだちと、とんでもない幸運');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  test.each(['/games/friendly-monsters/%2e%2e/%2e%2e/package.json', '/games/friendly-monsters/..%2f..%2fpackage.json', '/games/friendly-monsters/.env', '/games/friendly-monsters/assets/images/../../../../private_data/gpt-image/anything.webp'])('traversal/private path %s is denied', async url => {
    const response = await request(url); expect(response.status).toBe(404); expect(['', 'Not found']).toContain(response.body);
  });
  test('GET and HEAD are read-only and POST is not an operation', async () => {
    const head = await request('/games/friendly-monsters/index.html', 'HEAD'); expect(head.status).toBe(200); expect(head.body).toBe('');
    const post = await request('/games/friendly-monsters/index.html', 'POST'); expect(post.status).toBe(404);
  });
  test('supports confined MP3 range requests and image MIME types', async () => {
    const images = await request('/games/friendly-monsters/assets/images/bg01.webp', 'HEAD');
    expect(images.status).toBe(200); expect(images.headers['content-type']).toContain('image/webp');
    const file = require('fs').readdirSync(path.resolve(__dirname, '../../games/friendly-monsters/assets/audio')).find(x => x.endsWith('.mp3'));
    const audio = await request(`/games/friendly-monsters/assets/audio/${file}`, 'GET', { Range: 'bytes=0-31' });
    expect(audio.status).toBe(206); expect(audio.headers['content-type']).toContain('audio/mpeg'); expect(audio.headers['content-range']).toMatch(/^bytes 0-31\//);
  });
});
