const path = require('path');
const pug = require('pug');
const { buildMypageTiles } = require('../../services/mypageIconService');

const render = (isAdmin) => pug.renderFile(path.join(__dirname, '../../views/mypage.pug'), {
  admin: isAdmin,
  loggedIn: true,
  permissions: [],
  bookmarks: [],
  htmlPaths: [],
  tasks: [],
  new_openai_models: [],
  new_anthropic_models: [],
  mypageTiles: buildMypageTiles({ isAdmin }),
});

test.each([
  ['ask_lennart', '/admin/ask-lennart', 'Ask Lennart', 'Ask Lennart human request inbox'],
  ['runpod', '/admin/runpod', 'Runpod', 'Runpod GPU management dashboard'],
])('renders the %s admin link with the shared image, label and accessible controls', (id, href, label, alt) => {
  const html = render(true);
  expect(html).toContain(`data-tile-id="${id}"`);
  expect(html).toContain(`<a class="mypage-tile" href="${href}">`);
  expect(html).toContain(`<img class="mypage-img" src="/i/${id}.svg" alt="${alt}"`);
  expect(html).toContain(`<span class="img-card__label">${label}</span>`);
  expect(html).toContain(`aria-label="Move ${label} up"`);
  expect(html).toContain(`aria-label="Toggle ${label}"`);
});

test('non-admin My Page omits both admin links and their customization controls', () => {
  const html = render(false);
  for (const id of ['ask_lennart', 'runpod']) {
    expect(html).not.toContain(`data-tile-id="${id}"`);
    expect(html).not.toContain(`src="/i/${id}.svg"`);
  }
  expect(html).not.toContain('href="/admin/ask-lennart"');
  expect(html).not.toContain('href="/admin/runpod"');
  expect(html).not.toContain('aria-label="Toggle Ask Lennart"');
  expect(html).not.toContain('aria-label="Toggle Runpod"');
});
