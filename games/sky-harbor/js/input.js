(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;else root.SkyInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const codes = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
  class Input {
    constructor() {
      this.keys = new Set();
      this.pointers = new Map();
    }
    clear() {
      this.keys.clear();
      this.pointers.clear();
    }
    key(code, down) {
      if (!codes.has(code)) return false;
      if (down) this.keys.add(code);else this.keys.delete(code);
      return true;
    }
    values() {
      const held = new Set([...this.keys, ...this.pointers.values()]);
      const yes = (...c) => c.some(x => held.has(x)) ? 1 : 0;
      return {
        throttle: yes('KeyW') - yes('KeyS'),
        pitch: yes('ArrowDown') - yes('ArrowUp'),
        roll: yes('KeyD', 'ArrowRight') - yes('KeyA', 'ArrowLeft'),
        brake: held.has('Space')
      };
    }
  }
  return {
    Input,
    codes
  };
});
