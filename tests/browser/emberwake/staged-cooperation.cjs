// The long-distance camera positions, two work platforms and the chest stock
// in this scenario are explicit server fixtures. All rewards and interactions
// go through the live game protocol in two separate, authenticated browsers.
const assert = require('node:assert/strict');
const D = require('../../../multiplayer/emberwake/js/data');
const W = require('../../../multiplayer/emberwake/js/world');
module.exports = async function staged({ a, b, host, aim, until, wait, capture }) {
  const sea = host.room.sea,
    ga = sea.online.get(host.users.alice._id),
    gb = sea.online.get(host.users.bob._id);
  const act = (page, action) =>
    page.evaluate(
      action =>
        new Promise((resolve, reject) => {
          crewQA.socket
            .timeout(4000)
            .emit('act', action, (err, result) =>
              err ? reject(Error('Missing action acknowledgement')) : resolve(result)
            );
        }),
      action
    );
  const shift = async (page, g, x, y, z) => {
    Object.assign(g.state.player, { x, y: y + 0.01, z, boat: null });
    g.resetMotion();
    await page.waitForFunction(
      ([x, z]) => Math.hypot(crewQA.game.state.player.x - x, crewQA.game.state.player.z - z) < 0.2,
      [x, z]
    );
  };
  const steer = async (page, g, x, y, z) => {
    await page.bringToFront();
    if (await page.locator('#panel').evaluate(el => el.open)) await page.locator('#resume').click();
    else if (!(await page.evaluate(() => document.pointerLockElement === document.querySelector('#world'))))
      await page.locator('#world').click({ position: { x: 30, y: 310 }, force: true });
    await page.waitForFunction(() => document.pointerLockElement === document.querySelector('#world'));
    await aim(page, x + 0.5, y + 0.5, z + 0.5);
    await until(
      () => {
        const h = g.target();
        return h && h.x === x && h.y === y && h.z === z;
      },
      'staged view did not acquire ' + [x, y, z]
    );
  };
  const site = sea.world.soundings.find(r => r.id === 'oyster'),
    [x, y, z] = site.chest;
  for (const [page, g, dx] of [
    [a, ga, 0],
    [b, gb, -1]
  ]) {
    await shift(page, g, x + 0.5 + dx, 5.6, z + 3.5);
    await steer(page, g, x, y, z);
    const initial = g.state.inventory.pearl || 0;
    await page.keyboard.press('e');
    await until(() => g.state.salvaged.includes('oyster'), 'personal salvage missing');
    await page.keyboard.press('e');
    await wait(180);
    assert.equal(g.state.inventory.pearl, initial + site.loot.pearl);
  }
  await capture(b, 'drowned-coffer');
  const shelf = (x, z) => {
    for (let dx = -3; dx <= 4; dx++)
      for (let dz = -3; dz <= 3; dz++) sea.world.set(x + dx, 60, z + dz, D.ids.sand);
  };
  const block = (x, z, id) => {
    sea.world.set(x, 61, z, D.ids[id]);
    sea.shared.placed[W.key(x, 61, z)] = D.ids[id];
  };
  shelf(-100, -90);
  shelf(100, 0);
  block(-100, -90, 'chest');
  sea.shared.harvests['chest:-100,61,-90'] = { shell: 4 };
  for (const [page, g, dx] of [
    [a, ga, 0],
    [b, gb, 1]
  ]) {
    await shift(page, g, -99.5 + dx, 61, -87.5);
    await steer(page, g, -100, 61, -90);
    await page.keyboard.press('e');
    await page.getByRole('heading', { name: 'Cedar chest' }).waitFor();
  }
  const withdraw = { op: 'transfer', item: 'shell', count: 4, deposit: false };
  const receipts = await Promise.all([act(a, withdraw), act(b, withdraw)]);
  assert.equal(receipts.filter(r => r.ok).length, 1);
  assert.equal((ga.state.inventory.shell || 0) + (gb.state.inventory.shell || 0), 4);
  await shift(a, ga, 100.5, 61, 2.5);
  await steer(a, ga, 100, 60, 0);
  assert((await act(a, { op: 'select', slot: 7 })).ok);
  assert((await act(a, { op: 'place' })).ok);
  assert.equal(ga.state.base, '100,61,0');
  await shift(b, gb, 101.5, 61, 2.5);
  await steer(b, gb, 100, 61, 0);
  assert.equal((await act(b, { op: 'use' })).ok, false);
  await b.mouse.down();
  await wait(1200);
  await b.mouse.up();
  assert.equal(sea.world.get(100, 61, 0), D.ids.baseMarker);
  block(102, 0, 'portal');
  block(-98, -90, 'portal');
  await shift(b, gb, -97.5, 61.175, -89.5);
  await b.getByRole('heading', { name: 'Portal crossings' }).waitFor();
  await capture(b, 'protected-portals');
  await b.getByRole('button', { name: /102, 61, 0/ }).click();
  await until(() => Math.abs(gb.state.player.x - 102.5) < 0.1, 'crew portal travel failed');
  assert(!sea.canBuild(gb.crew.number, 102, 0));
  // Stage the approach only. Ordinary forward movement commits the crossing.
  await shift(a, ga, D.C.border - 0.12, 12, 0);
  await a.bringToFront();
  if (await a.locator('#panel').evaluate(el => el.open)) await a.locator('#resume').click();
  await aim(a, D.C.border + 10, ga.eye().y, 0);
  await a.keyboard.down('w');
  try {
    await until(() => ga.state.status === 'disaster', 'crossing did not trigger the storm');
  } finally {
    await a.keyboard.up('w');
  }
  await a.locator('#storm').waitFor({ state: 'visible' });
  await until(
    () => ga.state.status === 'alive' && Math.abs(ga.state.player.x - 100.5) < 2,
    'sailor did not respawn at their pennant'
  );
  assert.equal(ga.state.salvaged.length, 1);
  return {
    setup: 'Staged locations, platforms, storage stock and portal pads',
    personalClaims: 2,
    sharedWithdrawals: receipts.filter(r => r.ok).length,
    protectedBase: ga.state.base,
    visitorPortal: true,
    stormRespawn: true
  };
};
