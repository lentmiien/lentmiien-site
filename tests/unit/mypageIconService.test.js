const {
  buildMypageTiles,
  sanitizeMypageIconSettings,
} = require('../../services/mypageIconService');

describe('mypageIconService', () => {
  test('buildMypageTiles keeps saved order and appends omitted allowed icons', () => {
    const tiles = buildMypageTiles({
      permissions: ['chat5'],
      isAdmin: true,
      settings: {
        order: ['chat5'],
        hidden: ['my_life_log'],
      },
    });

    expect(tiles[0].id).toBe('chat5');
    expect(tiles[1].id).toBe('my_life_log');
    const lifeLogTile = tiles.find((tile) => tile.id === 'my_life_log');
    expect(lifeLogTile.hidden).toBe(true);
    expect(lifeLogTile.href).toBe('/admin/life_log');
    expect(tiles.some((tile) => tile.id === 'accounting')).toBe(false);
  });

  test('sanitizeMypageIconSettings merges submitted allowed ids with previous inaccessible settings', () => {
    const settings = sanitizeMypageIconSettings(
      {
        order: ['write_blog', 'chat5'],
        hidden: ['my_life_log', 'chat5'],
      },
      {
        order: ['chat5', 'my_life_log'],
        hidden: ['chat5'],
      },
      [],
      { isAdmin: true }
    );

    expect(settings.order.slice(0, 3)).toEqual(['write_blog', 'chat5', 'my_life_log']);
    expect(settings.hidden).toEqual(['my_life_log', 'chat5']);
    expect(settings.updatedAt).toBeInstanceOf(Date);
  });

  test('Qwen3 LoRA tile is visible only for admins', () => {
    const regularTiles = buildMypageTiles();
    const adminTiles = buildMypageTiles({ isAdmin: true });

    expect(regularTiles.some((tile) => tile.id === 'qwen3_lora')).toBe(false);
    expect(adminTiles.some((tile) => tile.id === 'qwen3_lora')).toBe(true);
  });

  test('My Life Log tile is visible only for admins', () => {
    const regularTiles = buildMypageTiles();
    const adminTiles = buildMypageTiles({ isAdmin: true });

    expect(regularTiles.some((tile) => tile.id === 'my_life_log')).toBe(false);
    expect(adminTiles.some((tile) => tile.id === 'my_life_log')).toBe(true);
  });

  test('Qwen3 LoRA text tile is available to regular logged-in users', () => {
    const regularTiles = buildMypageTiles();
    const tile = regularTiles.find((entry) => entry.id === 'qwen3_lora_text');

    expect(tile).toBeDefined();
    expect(tile.href).toBe('/qwen3-lora');
  });
});
