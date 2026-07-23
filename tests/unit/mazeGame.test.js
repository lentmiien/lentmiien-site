const fs = require('fs');
const path = require('path');

const gameRoot = path.join(process.cwd(), 'games', 'maze');
const core = require(path.join(gameRoot, 'js', 'maze_game_script.js'));

function countReachableCells(maze) {
  const size = maze.length;
  const directions = [
    { dx: 0, dy: -1, wall: 0 },
    { dx: 1, dy: 0, wall: 1 },
    { dx: 0, dy: 1, wall: 2 },
    { dx: -1, dy: 0, wall: 3 },
  ];
  const visited = new Set(['0,0']);
  const queue = [{ x: 0, y: 0 }];

  while (queue.length) {
    const current = queue.shift();
    directions.forEach(({ dx, dy, wall }) => {
      if (maze[current.x][current.y].walls[wall]) return;
      const next = { x: current.x + dx, y: current.y + dy };
      const key = `${next.x},${next.y}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push(next);
      }
    });
  }

  return visited.size;
}

describe('Ember Maze', () => {
  test('uses the shared theme and exposes swipe and overview controls', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'maze_game_style.css'), 'utf8');

    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('id="previewButton"');
    expect(html).toContain('aria-keyshortcuts="M"');
    expect(html).toContain('id="viewBadge"');
    expect(html).toContain('Swipe to move');
    expect(html).not.toContain('id="controls"');
    expect(html).not.toContain('id="upButton"');
    expect(styles).toContain('touch-action: none');
    expect(styles).toContain('var(--brand)');
    expect(styles).toContain('var(--accent)');
    expect(styles).toContain('var(--success)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('provides a dedicated accessible level-up reward', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'maze_game_script.js'), 'utf8');

    expect(html).toContain('id="levelUpOverlay"');
    expect(html).toContain('aria-labelledby="levelUpTitle"');
    expect(html).toContain('id="confetti"');
    expect(html).toContain('id="resultPoints"');
    expect(script).toContain('function openLevelReward(');
    expect(script).toContain('createConfetti();');
    expect(script).not.toContain('alert(');
  });

  test('maps dominant swipes to one of four movement directions', () => {
    expect(core.getSwipeDirection(60, 8)).toBe('right');
    expect(core.getSwipeDirection(-60, 8)).toBe('left');
    expect(core.getSwipeDirection(8, -60)).toBe('up');
    expect(core.getSwipeDirection(8, 60)).toBe('down');
    expect(core.getSwipeDirection(12, 9, 28)).toBeNull();
  });

  test('grows each level while keeping a practical upper bound', () => {
    expect(core.getMazeSize(5, 1)).toBe(5);
    expect(core.getMazeSize(5, 4)).toBe(11);
    expect(core.getMazeSize(9, 3)).toBe(13);
    expect(core.getMazeSize(9, 1000)).toBe(core.MAX_MAZE_SIZE);
  });

  test('generates a connected perfect maze with matching walls', () => {
    let seed = 0x12345678;
    const random = () => {
      seed = ((seed * 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const maze = core.generateMaze(19, random);
    let openWallCount = 0;

    expect(countReachableCells(maze)).toBe(19 * 19);

    for (let x = 0; x < maze.length; x += 1) {
      for (let y = 0; y < maze.length; y += 1) {
        if (x < maze.length - 1) {
          expect(maze[x][y].walls[1]).toBe(maze[x + 1][y].walls[3]);
          if (!maze[x][y].walls[1]) openWallCount += 1;
        }
        if (y < maze.length - 1) {
          expect(maze[x][y].walls[2]).toBe(maze[x][y + 1].walls[0]);
          if (!maze[x][y].walls[2]) openWallCount += 1;
        }
      }
    }

    expect(openWallCount).toBe((19 * 19) - 1);
  });
});
