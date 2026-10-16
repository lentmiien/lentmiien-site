jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
const { install } = require('../../utils/chat5RoomDelivery');
test('private room delivery revalidates recipients after membership changes', async () => {
  const old = { leave: jest.fn() }; const current = { leave: jest.fn() };
  const broadcast = jest.fn(); const rooms = new Map([['conversation:test', new Set(['old', 'current'])]]);
  const namespace = { adapter: { broadcast, rooms }, sockets: new Map([['old', old], ['current', current]]) };
  install({ of: () => namespace }, async socket => socket === current);
  await namespace.adapter.broadcast({ data: ['chat5-messages', { private: true }] }, { rooms: new Set(['conversation:test']), except: new Set() });
  expect(broadcast.mock.calls[0][1].except).toEqual(new Set(['old'])); expect(old.leave).toHaveBeenCalledWith('conversation:test');
});
test('authorization failure withholds private payload instead of falling back to the room', async () => {
  const broadcast = jest.fn(); const ns = { adapter: { broadcast, rooms: new Map([['conversation:test', new Set(['a'])]]) }, sockets: new Map([['a', {}]]) };
  install({ of: () => ns }, async () => { throw new Error('database unavailable'); });
  await ns.adapter.broadcast({ data: ['chat5-messages', {}] }, { rooms: new Set(['conversation:test']), except: new Set() });
  expect(broadcast).not.toHaveBeenCalled();
});
