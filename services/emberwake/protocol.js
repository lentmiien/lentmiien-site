'use strict';
const { integer, finite, plain, carry } = require('./state');
const D = require('../../multiplayer/emberwake/js/data');

function shape(value, keys) {
  return (
    plain(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k))
  );
}
function validInput(p) {
  return (
    shape(p, ['seq', 'keys', 'yaw', 'pitch']) &&
    integer(p.seq, 1, Number.MAX_SAFE_INTEGER) &&
    integer(p.keys, 0, 255) &&
    finite(p.yaw, -Math.PI, Math.PI) &&
    finite(p.pitch, -1.49, 1.49)
  );
}
const bits = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'down', 'mine'];
function controls(mask) {
  return Object.fromEntries(bits.map((key, n) => [key, !!(mask & (1 << n))]));
}
function validAction(a) {
  if (!plain(a) || typeof a.op !== 'string') return false;
  switch (a.op) {
    case 'use':
    case 'place':
    case 'eat':
    case 'home':
    case 'closeChest':
      return shape(a, ['op']);
    case 'select':
      return shape(a, ['op', 'slot']) && integer(a.slot, 0, 7);
    case 'assign':
      return (
        shape(a, ['op', 'slot', 'item']) &&
        integer(a.slot, 0, 7) &&
        typeof a.item === 'string' &&
        carry(a.item)
      );
    case 'craft':
      return (
        shape(a, ['op', 'item', 'count']) && D.recipes.some(r => r.id === a.item) && integer(a.count, 1, 20)
      );
    case 'travel':
      return (
        shape(a, ['op', 'exit']) && typeof a.exit === 'string' && /^-?\d{1,4},\d{1,2},-?\d{1,4}$/.test(a.exit)
      );
    case 'transfer':
      return (
        shape(a, ['op', 'item', 'count', 'deposit']) &&
        typeof a.item === 'string' &&
        carry(a.item) &&
        integer(a.count, 1, D.C.stack) &&
        typeof a.deposit === 'boolean'
      );
    case 'settings':
      return (
        shape(a, ['op', 'sound', 'sensitivity', 'view']) &&
        typeof a.sound === 'boolean' &&
        finite(a.sensitivity, 0.25, 3) &&
        integer(a.view, 3, 5)
      );
    default:
      return false;
  }
}
module.exports = { validInput, validAction, controls };
