const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Cube = require('../../games/rubiks-cube/vendor/cube');
const SolverClient = require('../../games/rubiks-cube/js/solver-client');
require('../../games/rubiks-cube/vendor/solve');

describe('solver worker with actual vendored search', () => {
  let worker, messages;
  beforeAll(() => {
    const base = path.join(process.cwd(), 'games/rubiks-cube/js');
    messages = [];
    worker = vm.createContext({ postMessage: value => messages.push(value) });
    worker.self = worker;
    worker.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(base, file), 'utf8'), worker));
    vm.runInContext(fs.readFileSync(path.join(base, 'solver-worker.js'), 'utf8'), worker);
  });
  beforeEach(() => { messages.length = 0; });
  test('invalid input is rejected without initializing expensive solver tables', () => {
    worker.onmessage({ data: 'U'.repeat(100000) });
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('error');
    expect(worker.Cube.moveTables.twist).toBeNull();
  });
  test('solves arbitrary entered states, not only reverse scramble history', () => {
    for (let i = 0; i < 5; i++) {
      const cube = Cube.random();
      worker.onmessage({ data: cube.asString() });
      const result = messages[messages.length - 1];
      expect(result.type).toBe('solution');
      expect(result.moves.length).toBeLessThanOrEqual(22);
      expect(cube.move(result.moves.join(' ')).isSolved()).toBe(true);
    }
  }, 45000);
  test('already solved cubes return no turns', () => {
    worker.onmessage({ data: new Cube().asString() });
    expect(messages[messages.length - 1]).toEqual({ type: 'solution', moves: [] });
  });
  test('physically impossible states never enter search', () => {
    const cube = new Cube();
    cube.co[0] = 1;
    worker.onmessage({ data: cube.asString() });
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('error');
  });
});

describe('solver client lifecycle and work bounds', () => {
  let worker, factory, client;
  beforeEach(() => {
    jest.useFakeTimers();
    worker = { postMessage: jest.fn(), terminate: jest.fn() };
    factory = jest.fn(() => worker);
    client = new SolverClient(factory, 45000);
  });
  afterEach(() => { client.cancel(); jest.useRealTimers(); });
  test('relays status and reuses one worker for sequential jobs', async () => {
    const status = jest.fn();
    const pending = client.solve('state', status);
    worker.onmessage({ data: { type: 'status', message: 'Preparing' } });
    worker.onmessage({ data: { type: 'solution', moves: ["R'", 'U2'] } });
    await expect(pending).resolves.toEqual(["R'", 'U2']);
    expect(status).toHaveBeenCalledWith('Preparing');
    const next = client.solve('another');
    worker.onmessage({ data: { type: 'solution', moves: [] } });
    await expect(next).resolves.toEqual([]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
  test('rejects concurrent requests', async () => {
    const pending = client.solve('one');
    await expect(client.solve('two')).rejects.toThrow(/already/);
    client.cancel();
    await expect(pending).rejects.toThrow(/cancelled/);
  });
  test('timeout terminates worker and a retry creates a new worker', async () => {
    const pending = client.solve('state');
    jest.advanceTimersByTime(45000);
    await expect(pending).rejects.toThrow(/too long/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const retry = client.solve('state');
    client.cancel();
    await expect(retry).rejects.toThrow(/cancelled/);
    expect(factory).toHaveBeenCalledTimes(2);
  });
  test('cancellation stops work and clears its deadline', async () => {
    const pending = client.solve('state');
    client.cancel();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
  test('late responses from a cancelled worker cannot complete a new search', async () => {
    const first = client.solve('first');
    const staleMessage = worker.onmessage;
    client.cancel();
    await expect(first).rejects.toThrow(/cancelled/);
    const next = client.solve('next');
    staleMessage({ data: { type: 'solution', moves: ['R'] } });
    expect(client.pending).not.toBeNull();
    worker.onmessage({ data: { type: 'solution', moves: ['U'] } });
    await expect(next).resolves.toEqual(['U']);
  });
  test.each([null, {}, { type: 'solution', moves: 'R' }, { type: 'solution', moves: ['<script>'] }, { type: 'solution', moves: Array(23).fill('R') }])('rejects malformed solver responses: %p', async data => {
    const pending = client.solve('state');
    worker.onmessage({ data });
    await expect(pending).rejects.toThrow(/could not finish/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  test('reports worker resource load errors', async () => {
    const pending = client.solve('state');
    worker.onerror({ preventDefault: jest.fn() });
    await expect(pending).rejects.toThrow(/could not load/);
  });
  test('handles unsupported/blocked Workers without leaving a pending request', async () => {
    const blocked = new SolverClient(() => { throw new Error('blocked'); });
    await expect(blocked.solve('state')).rejects.toThrow(/could not start/);
    expect(blocked.pending).toBeNull();
  });
});
