(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api; else root.DescentInput = api;
})(globalThis, function () {
  const bindings = { KeyW: 'main', ArrowUp: 'main', Space: 'main', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  class Input {
    constructor() { this.keys = new Set(); this.pointers = new Map(); }
    clear() { this.keys.clear(); this.pointers.clear(); }
    key(code, down) {
      if (!bindings[code]) return false;
      if (down) this.keys.add(code); else this.keys.delete(code);
      return true;
    }
    values() {
      const active = new Set([...this.keys].map(k => bindings[k]).concat([...this.pointers.values()]));
      return { main: active.has('main'), left: active.has('left'), right: active.has('right') };
    }
  }
  return { Input, bindings };
});
