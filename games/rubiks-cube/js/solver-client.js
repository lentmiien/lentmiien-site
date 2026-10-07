(function (root) {
  'use strict';
  class SolverClient {
    constructor(makeWorker = () => new Worker('js/solver-worker.js'), timeout = 45000) {
      this.makeWorker = makeWorker;
      this.timeout = timeout;
      this.worker = null;
      this.pending = null;
    }
    solve(state, onStatus = () => {}) {
      if (this.pending) return Promise.reject(new Error('A search is already running.'));
      return new Promise((resolve, reject) => {
        const request = { resolve, reject };
        this.pending = request;
        const finish = (error, moves) => {
          if (this.pending !== request) return;
          clearTimeout(this.timer);
          this.pending = null;
          if (error) {
            this.worker?.terminate();
            this.worker = null;
            reject(error);
          } else resolve(moves);
        };
        try {
          if (!this.worker) this.worker = this.makeWorker();
          this.worker.onmessage = ({ data }) => {
            if (this.pending !== request) return;
            if (data?.type === 'status' && typeof data.message === 'string') onStatus(data.message.slice(0, 200));
            else if (data?.type === 'solution' && Array.isArray(data.moves) && data.moves.length <= 22 && data.moves.every(move => typeof move === 'string' && /^[URFDLB](2|')?$/.test(move))) finish(null, data.moves);
            else finish(new Error('The solver could not finish. Check your cube and try again.'));
          };
          this.worker.onerror = event => {
            event.preventDefault?.();
            finish(new Error('The solver could not load. Reload the page or try again.'));
          };
          this.worker.onmessageerror = () => finish(new Error('The solver response could not be read. Please try again.'));
          this.timer = setTimeout(() => finish(new Error('The search took too long and was stopped. Please try again.')), this.timeout);
          this.worker.postMessage(state);
        } catch {
          finish(new Error('The solver could not start. Use a browser that supports Web Workers.'));
        }
      });
    }
    cancel() {
      clearTimeout(this.timer);
      this.worker?.terminate();
      this.worker = null;
      if (this.pending) {
        this.pending.reject(new Error('Search cancelled. Your cube is unchanged.'));
        this.pending = null;
      }
    }
  }
  if (typeof module === 'object' && module.exports) module.exports = SolverClient;
  else root.SolverClient = SolverClient;
})(typeof self !== 'undefined' ? self : globalThis);
