(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../vendor/cube') : root.Cube);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeLab = api;
})(typeof self !== 'undefined' ? self : globalThis, function (Cube) {
  'use strict';
  const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
  const names = { U: 'top', R: 'right', F: 'front', D: 'bottom', L: 'left', B: 'back' };
  const colors = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
  const letters = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
  const solved = faces.map(face => face.repeat(9)).join('');
  // Coordinates: +X right, +Y up, +Z front. Each face is viewed from outside.
  const frames = {
    U: { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
    R: { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
    F: { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
    D: { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
    L: { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
    B: { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
  };
  function facelet(index) {
    const face = faces[Math.floor(index / 9)];
    const { normal, right, up } = frames[face];
    const row = Math.floor(index % 9 / 3), column = index % 3;
    return { face, normal, position: normal.map((n, axis) => n + (column - 1) * right[axis] + (1 - row) * up[axis]) };
  }
  function parseMove(move) {
    if (typeof move !== 'string' || !/^[URFDLB](2|')?$/.test(move)) throw new Error('Use a face letter with an optional prime or 2.');
    const face = move[0], normal = frames[face].normal;
    const axis = normal.findIndex(n => n !== 0), layer = normal[axis];
    return { face, axis, layer, angle: -layer * Math.PI / 2 * (move.endsWith('2') ? 2 : move.endsWith("'") ? -1 : 1) };
  }
  function inverse(move) {
    parseMove(move);
    return move.endsWith('2') ? move : move.endsWith("'") ? move[0] : `${move}'`;
  }
  function describe(move) {
    const { face } = parseMove(move);
    const direction = move.endsWith('2') ? 'a half turn (180°)' : move.endsWith("'") ? 'counterclockwise (90°)' : 'clockwise (90°)';
    return `Turn the ${names[face]} (${colors[face]} center) face ${direction}, looking directly at that face.`;
  }
  function parity(values) {
    let count = 0;
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) if (values[i] > values[j]) count++;
    return count % 2;
  }
  function validate(state) {
    if (typeof state !== 'string' || state.length !== 54 || !/^[URFDLB]+$/.test(state)) return { ok: false, error: 'Fill all 54 stickers with one of the six colors.' };
    if (faces.some(face => state.split(face).length - 1 !== 9)) return { ok: false, error: 'Use exactly nine stickers of each color. Check the color counts below.' };
    if (faces.some((face, i) => state[i * 9 + 4] !== face)) return { ok: false, error: 'Keep the six center stickers in their fixed positions.' };
    const cube = Cube.fromString(state);
    if (new Set(cube.cp).size !== 8 || new Set(cube.ep).size !== 12 || cube.asString() !== state) return { ok: false, error: 'These colors contain a missing, repeated, or impossible piece. Check the edges and corners and each face’s orientation.' };
    if (cube.eo.reduce((a, b) => a + b, 0) % 2) return { ok: false, error: 'An edge is flipped. This cannot be solved with face turns; recheck the two stickers on each edge.' };
    if (cube.co.reduce((a, b) => a + b, 0) % 3) return { ok: false, error: 'A corner is twisted. This cannot be solved with face turns; recheck the three stickers on each corner.' };
    if (parity(cube.cp) !== parity(cube.ep)) return { ok: false, error: 'Two pieces are swapped (parity mismatch). Recheck your entry; face turns cannot solve this configuration.' };
    return { ok: true, cube };
  }
  function scramble(random = Math.random) {
    const moves = [], axes = { U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 };
    for (let i = 0; i < 25; i++) {
      const available = faces.filter(face => !i || axes[face] !== axes[moves[i - 1][0]]);
      moves.push(available[Math.floor(random() * available.length)] + ['', "'", '2'][Math.floor(random() * 3)]);
    }
    return moves;
  }
  function rotate(vector, axis, angle) {
    const result = vector.slice(), a = (axis + 1) % 3, b = (axis + 2) % 3;
    result[a] = vector[a] * Math.cos(angle) - vector[b] * Math.sin(angle);
    result[b] = vector[a] * Math.sin(angle) + vector[b] * Math.cos(angle);
    return result;
  }
  return { faces, names, colors, letters, solved, frames, facelet, parseMove, inverse, describe, validate, scramble, rotate };
});
