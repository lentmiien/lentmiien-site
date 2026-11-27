// Run against an explicitly supplied disposable loopback Mongo, never the site database.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const model = require('../../../models/emberwake_world');
const { Repository, WORLD } = require('../../../services/emberwake/repository');
const State = require('../../../services/emberwake/state');
const D = require('../../../multiplayer/emberwake/js/data');
const { fixture } = require('./fixture.cjs');
const uri = process.env.EMBERWAKE_TEST_MONGO_URI || '';
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri))
  throw Error('Supply a disposable mongodb://127.0.0.1:PORT without credentials or database.');
const output = process.env.EVIDENCE_DIR;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(test, reason, timeout = 18000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await test()) return;
    await wait(75);
  }
  throw Error(reason);
}
async function run() {
  const db = await mongoose
    .createConnection(uri, {
      dbName: 'emberwake_qa_' + crypto.randomBytes(8).toString('hex'),
      serverSelectionTimeoutMS: 4000
    })
    .asPromise();
  const coll = db.model('CrewFixture', model.schema);
  let host, browser;
  const evidence = {},
    errors = [];
  try {
    await coll.createCollection();
    const first = new Repository({ model: coll }),
      rival = new Repository({ model: coll });
    const opened = await first.acquire();
    await assert.rejects(rival.acquire(), { code: 'WORLD_BUSY' });
    const op = {
      raw: State.encode(State.initial(74621)),
      revision: opened.revision,
      paused: false,
      release: true,
      id: crypto.randomUUID()
    };
    const persisted = await first.save(op);
    assert.equal((await first.save(op)).revision, persisted.revision);
    await assert.rejects(first.save({ ...op, id: crypto.randomUUID() }), { code: 'LEASE_LOST' });
    evidence.mongo = 'exclusive writer, majority write, repeat acknowledgement and stale revision checked';
    host = await fixture(new Repository({ model: coll }));
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH,
      args: [
        '--no-sandbox',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'
      ]
    });
    const create = async name => {
      const context = await browser.newContext({ viewport: { width: 1024, height: 720 } });
      if (name)
        assert.equal(
          (
            await context.request.post(host.origin + '/_fixture/session/' + name, {
              headers: { 'x-test-key': host.secret }
            })
          ).status(),
          204
        );
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', e => errors.push(String(e.message)));
      // Read-only instrumentation plus aiming through real mouse events. No test hooks ship in the game.
      await page.route('**/js/boot.js', async route => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            '\nwindow.crewQA={get game(){return game},get scene(){return renderer},get peers(){return peers},get socket(){return socket}};'
        });
      });
      return { context, page };
    };
    const guest = await create();
    for (const url of ['/', '/js/game.js', '/assets/atlas.png', '/status', '/harbormaster']) {
      const response = await guest.context.request.get(host.origin + '/emberwake-online' + url);
      assert.equal(response.status(), 401);
      assert.match(response.headers()['cache-control'], /no-store/);
    }
    await guest.context.close();
    const noGrant = await create('guest');
    assert.equal((await noGrant.context.request.get(host.origin + '/emberwake-online/')).status(), 403);
    await noGrant.context.close();
    const a = await create('alice'),
      b = await create('bob'),
      admin = await create('admin');
    await admin.page.goto(host.origin + '/emberwake-online/harbormaster');
    const adminPost = await admin.context.request.post(host.origin + '/emberwake-online/maintenance', {
      data: { paused: true }
    });
    assert.equal(adminPost.status(), 403);
    assert.equal(
      (
        await a.context.request.post(host.origin + '/emberwake-online/maintenance', {
          data: { paused: true }
        })
      ).status(),
      403
    );
    const join = async p => {
      await p.goto(host.origin + '/emberwake-online/');
      await p.locator('#joinGame').click();
      await p
        .waitForFunction(
          () => document.querySelector('#panel').open || !document.querySelector('#fatal').hidden,
          null,
          { timeout: 40000 }
        )
        .catch(async err => {
          console.error(
            'Join diagnostics',
            await p.evaluate(() => ({
              loading: document.querySelector('#loadText').textContent,
              boot: !!window.crewQA,
              socket: window.crewQA?.socket?.connected
            })),
            await host.room.status(),
            errors
          );
          throw err;
        });
      assert.equal(await p.locator('#fatal').isVisible(), false, await p.locator('#fatalText').innerText());
    };
    const capture = async (p, name) => {
      if (output) {
        await fs.mkdir(output, { recursive: true });
        await p.screenshot({ path: path.join(output, name + '.jpg'), type: 'jpeg', quality: 81 });
      }
    };
    await a.page.goto(host.origin + '/emberwake-online/');
    await capture(a.page, 'harbor');
    // A rejected CSRF handshake must not acquire a berth.
    const denied = await a.page.evaluate(
      () =>
        new Promise(resolve => {
          const s = io('/voyage', {
            path: '/emberwake-online/live',
            transports: ['websocket'],
            auth: { csrf: 'invalid' },
            forceNew: true,
            reconnection: false
          });
          s.on('connect_error', e => {
            s.disconnect();
            resolve(e.message);
          });
        })
    );
    assert.equal(denied, 'SESSION_ENDED');
    assert.equal(host.room.members.size, 0);
    await join(a.page);
    await join(b.page);
    await a.page.waitForFunction(() => crewQA.scene.crew.people.size === 1);
    const who = k => host.room.sea.online.get(host.users[k]._id);
    const resume = async p => {
      await p.bringToFront();
      await p.locator('#resume').click();
      await p.waitForFunction(() => document.pointerLockElement === document.querySelector('#world'));
    };
    const aim = async (p, x, y, z) => {
      const [dx, dy] = await p.evaluate(
        ([x, y, z]) => {
          const g = crewQA.game,
            e = g.eye(),
            v = g.state.player;
          const desired = Math.atan2(e.x - x, e.z - z),
            pitch = Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z));
          const turn = Math.atan2(Math.sin(v.yaw - desired), Math.cos(v.yaw - desired));
          return [
            Math.round(turn / (0.0022 * g.state.settings.sensitivity)),
            Math.round((v.pitch - pitch) / (0.0022 * g.state.settings.sensitivity))
          ];
        },
        [x, y, z]
      );
      // Chromium's headless pointer lock does not consistently forward CDP relative
      // distances. Deliver the measured relative mouse event to the normal handler.
      await p.evaluate(
        ([movementX, movementY]) =>
          window.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY })),
        [dx, dy]
      );
    };
    await resume(a.page);
    const pb = who('bob').state.player;
    await aim(a.page, pb.x, pb.y + 1, pb.z);
    await wait(550);
    await capture(a.page, 'two-sailors');
    evidence.peers = await a.page.evaluate(() => ({
      name: crewQA.peers[0].name,
      renderedAvatars: crewQA.scene.crew.people.size,
      drawCalls: crewQA.scene.renderer.info.render.calls
    }));
    assert.equal(evidence.peers.renderedAvatars, 1);
    // Walk from a fresh spawn toward a naturally generated piece of starter driftwood.
    const g = who('alice'),
      p = g.state.player;
    const logs = g.world
      .starterProps()
      .filter(row => row[3] === D.ids.log)
      .sort((l, r) => Math.hypot(l[0] - p.x, l[2] - p.z) - Math.hypot(r[0] - p.x, r[2] - p.z));
    const [x, y, z] = logs[0];
    await aim(a.page, x + 0.5, y + 0.5, z + 0.5);
    const start = { x: p.x, z: p.z };
    await a.page.keyboard.down('w');
    try {
      await until(() => Math.hypot(p.x - x - 0.5, p.z - z - 0.5) < 3.7, 'failed to walk to starter log');
    } finally {
      await a.page.keyboard.up('w');
    }
    await wait(220);
    await aim(a.page, x + 0.5, y + 0.5, z + 0.5);
    await until(() => g.target()?.id === D.ids.log, 'pointer-lock aiming missed the log');
    const hit = g.target();
    await a.page.mouse.down();
    try {
      await until(() => g.state.inventory.log === 1, 'server mining did not finish');
    } finally {
      await a.page.mouse.up();
    }
    await b.page.waitForFunction(([x, y, z]) => crewQA.game.world.get(x, y, z) === 0, [hit.x, hit.y, hit.z]);
    await a.page.keyboard.press('b');
    await a.page.locator('button[data-recipe="plank"]').click();
    await until(() => g.state.inventory.plank > 0, 'recipe did not award planks');
    evidence.fromSpawn = {
      walkedMetres: Math.round(Math.hypot(p.x - start.x, p.z - start.z) * 10) / 10,
      mined: [hit.x, hit.y, hit.z],
      planks: g.state.inventory.plank,
      peerReceivedEdit: true
    };
    await a.page.getByRole('button', { name: 'Pack', exact: true }).click();
    await a.page.locator('.pack button').filter({ hasText: 'plank' }).first().click();
    await until(() => g.selected() === 'plank', 'hotbar assignment did not arrive');
    await resume(a.page);
    const floorX = Math.floor(p.x) + 1,
      floorZ = Math.floor(p.z) - 1,
      floorY = g.world.top(floorX, floorZ) - 1;
    await aim(a.page, floorX + 0.5, floorY + 0.5, floorZ + 0.5);
    await wait(200);
    await a.page.mouse.down({ button: 'right' });
    await a.page.mouse.up({ button: 'right' });
    await until(() => g.state.stats.placed === 1, 'shared building did not finish');
    await b.page.waitForFunction(() => Object.values(crewQA.game.state.placed).includes(EWData.ids.plank));
    evidence.fromSpawn.placedPlank = true;
    await a.page.keyboard.press('m');
    await capture(a.page, 'shared-chart');
    evidence.stagedCooperation = await require('./staged-cooperation.cjs')({
      a: a.page,
      b: b.page,
      host,
      aim,
      until,
      wait,
      capture
    });
    const pos = { x: p.x, y: p.y, z: p.z },
      takeover = await create('alice');
    await join(takeover.page);
    await a.page.getByRole('heading', { name: 'Voyage moved' }).waitFor();
    assert.equal(host.room.members.size, 2);
    assert.equal(who('alice').state.player.x, pos.x);
    await until(
      async () => await coll.exists({ _id: WORLD, revision: { $gte: 2 } }),
      'no active 30 second checkpoint',
      42000
    );
    assert.equal((await coll.findById(WORLD).lean()).writer !== null, true);
    await admin.page.locator('#maintenanceChange').click();
    await admin.page.getByText(/all crew disconnected/).waitFor();
    await b.page.getByRole('heading', { name: 'Harbor closed for maintenance' }).waitFor();
    await takeover.page.getByRole('heading', { name: 'Harbor closed for maintenance' }).waitFor();
    await capture(admin.page, 'maintenance');
    assert.equal(host.room.members.size, 0);
    assert.equal(host.room.timer, null);
    const saved = await coll.findById(WORLD).lean(),
      stored = State.decode(saved.payload);
    assert(saved.paused);
    assert.equal(saved.writer, null);
    assert.equal(stored.crew.length, 2);
    const alice = stored.crew.find(r => r.user === host.users.alice._id);
    assert.equal(alice.data.stats.placed, 2);
    assert.deepEqual(alice.data.salvaged, ['oyster']);
    assert.equal(alice.data.base, '100,61,0');
    assert.equal(alice.data.player.x, pos.x);
    const time = stored.time;
    await host.close();
    host = await fixture(new Repository({ model: coll }));
    const returned = await create('alice'),
      boss = await create('admin');
    await returned.page.goto(host.origin + '/emberwake-online/');
    assert(await returned.page.locator('#joinGame').isDisabled());
    assert.deepEqual(await host.room.status(), {
      paused: true,
      savedAt: +saved.savedAt,
      blocked: false,
      online: 0
    });
    assert.equal(State.decode((await coll.findById(WORLD).lean()).payload).time, time);
    await boss.page.goto(host.origin + '/emberwake-online/harbormaster');
    await boss.page.locator('#maintenanceChange').click();
    await boss.page.getByText('Open · crew can join again').waitFor();
    await join(returned.page);
    assert.equal(who('alice').state.inventory.plank, alice.data.inventory.plank);
    assert.equal(who('alice').state.player.x, pos.x);
    const revoked = await create('bob');
    await join(revoked.page);
    host.users.bob.type_user = 'fixture-no-grants';
    await revoked.page.getByRole('heading', { name: 'Sign in again' }).waitFor();
    assert.equal(host.room.members.size, 1);
    evidence.liveCapabilityRevocation = true;
    await returned.page.getByRole('button', { name: 'Crew', exact: true }).click();
    await returned.page.getByRole('button', { name: 'Leave the voyage' }).click();
    await until(() => host.room.sea === null, 'last departure did not checkpoint');
    evidence.recovery = {
      pausedRevision: saved.revision,
      characters: stored.crew.length,
      activeTimeSeconds: Math.round(time),
      takeover: true,
      reopenedInFreshProcessState: true,
      finalRevision: (await coll.findById(WORLD).lean()).revision
    };
    assert.deepEqual(errors, []);
    evidence.browserErrors = errors;
    console.log(JSON.stringify(evidence, null, 2));
    if (output)
      await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2) + '\n');
  } finally {
    await browser?.close();
    await host?.close();
    await db.dropDatabase();
    await db.close();
  }
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
