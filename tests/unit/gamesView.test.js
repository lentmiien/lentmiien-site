const path = require('path');
const pug = require('pug');

describe('games page', () => {
  test('renders the themed game list inside the shared app layout', () => {
    const html = pug.renderFile(path.join(process.cwd(), 'views/games.pug'), {
      pageTitle: 'Games',
      loggedIn: false,
      games: [
        { name: 'Maze', href: '/maze' },
        { name: 'Memory Match', href: '/memory_match' },
      ],
    });

    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('href="/css/games.css"');
    expect(html).toContain('id="navbar"');
    expect(html).toContain('href="/maze"');
    expect(html).toContain('href="/memory_match"');
    expect(html).toContain('Choose your next game');
  });
});
