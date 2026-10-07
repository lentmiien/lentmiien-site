const Cube = require('../../games/rubiks-cube/vendor/cube');
const lab = require('../../games/rubiks-cube/js/core');

describe('Rubik’s Cube model and input validation', () => {
  test('accepts solved and independently scrambled facelet strings', () => {
    expect(lab.validate(lab.solved).ok).toBe(true);
    for (let i = 0; i < 30; i++) {
      const cube = Cube.random();
      expect(lab.validate(cube.asString()).ok).toBe(true);
    }
  });
  test.each([null, undefined, {}, [], 54, '', 'U'.repeat(55), '<script>alert(1)</script>', 'X'.repeat(54)])('rejects malformed or excessive input: %p', input => {
    expect(lab.validate(input).ok).toBe(false);
  });
  test('rejects wrong color counts before decoding pieces', () => {
    expect(lab.validate('R' + lab.solved.slice(1)).error).toMatch(/nine/);
  });
  test('rejects displaced centers even when the counts are correct', () => {
    const state = lab.solved.split('');
    [state[4], state[13]] = [state[13], state[4]];
    expect(lab.validate(state.join('')).error).toMatch(/center/);
  });
  test('rejects impossible/mirrored corner color combinations', () => {
    const state = lab.solved.split('');
    [state[9], state[20]] = [state[20], state[9]];
    expect(lab.validate(state.join('')).error).toMatch(/piece/);
  });
  test('rejects duplicate pieces even with balanced color counts', () => {
    const cube = new Cube();
    cube.ep[0] = 2;
    cube.ep[6] = 4;
    expect(lab.validate(cube.asString()).ok).toBe(false);
  });
  test('rejects a single flipped edge', () => {
    const cube = new Cube();
    cube.eo[0] = 1;
    expect(lab.validate(cube.asString()).error).toMatch(/edge is flipped/);
  });
  test('rejects a single twisted corner', () => {
    const cube = new Cube();
    cube.co[0] = 1;
    expect(lab.validate(cube.asString()).error).toMatch(/corner is twisted/);
  });
  test('rejects impossible permutation parity', () => {
    const cube = new Cube();
    [cube.ep[0], cube.ep[1]] = [cube.ep[1], cube.ep[0]];
    expect(lab.validate(cube.asString()).error).toMatch(/parity/);
  });
  test.each(['R3', 'x', 'r', 'R U', "R''", '', null, {}])('rejects invalid moves: %p', move => {
    expect(() => lab.parseMove(move)).toThrow();
    expect(() => lab.inverse(move)).toThrow();
  });
  test('scrambles have 25 legal turns without consecutive same-axis turns', () => {
    for (let i = 0; i < 20; i++) {
      const moves = lab.scramble();
      expect(moves).toHaveLength(25);
      moves.forEach((move, index) => {
        if (index) expect(lab.parseMove(move).axis).not.toBe(lab.parseMove(moves[index - 1]).axis);
      });
      const cube = new Cube().move(moves.join(' '));
      expect(cube.isSolved()).toBe(false);
      expect(lab.validate(cube.asString()).ok).toBe(true);
      cube.move(moves.reverse().map(lab.inverse).join(' '));
      expect(cube.isSolved()).toBe(true);
    }
  });
});

describe('animation geometry agrees with actual solver moves', () => {
  const key = (position, normal) => [...position, ...normal].map(Math.round).join(',');
  const geometry = Array.from({ length: 54 }, (_, i) => lab.facelet(i));
  const indices = new Map(geometry.map((g, i) => [key(g.position, g.normal), i]));
  test('all 54 exterior stickers have distinct coordinates', () => { expect(indices.size).toBe(54); });
  test.each(lab.faces.flatMap(face => [face, `${face}'`, `${face}2`]))('%s animates every sticker to the right destination', move => {
    const state = new Cube().move("R F' D2 B L U' R2 B2").asString();
    const expected = Cube.fromString(state).move(move).asString();
    const { axis, layer, angle } = lab.parseMove(move);
    const output = new Array(54);
    geometry.forEach((g, i) => {
      const moving = g.position[axis] === layer;
      const position = moving ? lab.rotate(g.position, axis, angle) : g.position;
      const normal = moving ? lab.rotate(g.normal, axis, angle) : g.normal;
      output[indices.get(key(position, normal))] = state[i];
    });
    expect(output.join('')).toBe(expected);
    expect(Cube.fromString(expected).move(lab.inverse(move)).asString()).toBe(state);
  });
});
