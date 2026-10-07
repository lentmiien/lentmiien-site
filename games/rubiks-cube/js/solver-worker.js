'use strict';
importScripts('../vendor/cube.js', '../vendor/solve.js', 'core.js');
let initialized = false;
self.onmessage = function (event) {
  const result = CubeLab.validate(event.data);
  if (!result.ok) {
    self.postMessage({ type: 'error', message: result.error });
    return;
  }
  if (result.cube.isSolved()) {
    self.postMessage({ type: 'solution', moves: [] });
    return;
  }
  try {
    if (!initialized) {
      self.postMessage({ type: 'status', message: 'Preparing the solver… This first search may take a few seconds.' });
      Cube.initSolver();
      initialized = true;
    }
    self.postMessage({ type: 'status', message: 'Finding a solution… Your cube stays on this device.' });
    const algorithm = result.cube.solve(22);
    const moves = algorithm.trim() ? algorithm.trim().split(/\s+/) : [];
    if (moves.length > 22 || moves.some(move => !/^[URFDLB](2|')?$/.test(move)) || !result.cube.clone().move(algorithm).isSolved()) throw new Error('Invalid solution');
    self.postMessage({ type: 'solution', moves });
  } catch {
    self.postMessage({ type: 'error', message: 'The solver could not finish. Please check the cube and try again.' });
  }
};
