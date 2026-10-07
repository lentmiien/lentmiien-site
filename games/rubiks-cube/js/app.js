(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  try {
    const lab = CubeLab;
    const renderer = new CubeRenderer($('cube'));
    const solver = new SolverClient();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let mode = 'game', gameCube = new Cube(), solveCube = null;
    let draft = lab.solved, selectedColor = 'U', history = [], turnCount = 0;
    let moves = null, position = 0, solutionStart = null;
    let busy = false, searching = false, playing = false, timer = null;
    const stickers = [], paletteButtons = [], moveButtons = [], countLabels = [];
    const shownState = () => mode === 'game' ? gameCube.asString() : moves ? solveCube.asString() : draft;
    const editing = () => mode === 'solve' && !moves && !searching;
    const button = (label, action) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = label;
      element.addEventListener('click', action);
      return element;
    };
    for (const face of lab.faces) {
      const group = document.createElement('div');
      group.className = 'face-controls';
      const label = document.createElement('span');
      label.textContent = `${face} · ${lab.names[face]}`;
      group.append(label);
      for (const suffix of ['', "'"]) {
        const move = face + suffix;
        const element = button(move.replace("'", '′'), () => playerTurn(move));
        element.title = lab.describe(move);
        element.setAttribute('aria-label', lab.describe(move));
        element.dataset.move = move;
        group.append(element);
        moveButtons.push(element);
      }
      $('moveButtons').append(group);
      const colorButton = button(lab.colors[face], () => {
        selectedColor = face;
        for (const entry of paletteButtons) entry.setAttribute('aria-pressed', String(entry.dataset.color === face));
      });
      colorButton.dataset.color = face;
      colorButton.setAttribute('aria-pressed', String(face === selectedColor));
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.setAttribute('aria-hidden', 'true');
      colorButton.prepend(swatch);
      paletteButtons.push(colorButton);
      $('palette').append(colorButton);
      const faceElement = document.createElement('div');
      faceElement.className = 'net-face';
      faceElement.dataset.face = face;
      const heading = document.createElement('span');
      heading.className = 'face-name';
      heading.textContent = `${face} · ${lab.names[face]}`;
      const grid = document.createElement('div');
      grid.className = 'face-grid';
      for (let cell = 0; cell < 9; cell++) {
        const index = lab.faces.indexOf(face) * 9 + cell;
        const tile = button('', () => {
          if (!editing() || cell === 4) return;
          draft = draft.slice(0, index) + selectedColor + draft.slice(index + 1);
          status('Entry updated. Match all six faces, then choose Find solution.');
          render();
        });
        tile.className = 'sticker';
        tile.dataset.index = index;
        tile.dataset.center = String(cell === 4);
        stickers[index] = tile;
        grid.append(tile);
      }
      faceElement.append(heading, grid);
      $('net').append(faceElement);
      const count = document.createElement('span');
      count.dataset.color = face;
      const dot = document.createElement('i');
      dot.className = 'swatch';
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      count.append(dot, text);
      countLabels.push({ face, count, text });
      $('colorCounts').append(count);
    }
    function render() {
      const state = shownState();
      document.body.dataset.mode = mode;
      renderer.setState(state);
      renderer.setHighlight(mode === 'solve' && moves && position < moves.length ? moves[position][0] : null);
      $('cubeBadge').textContent = state === lab.solved ? 'Solved' : editing() ? 'Editing' : 'Unsolved';
      $('stageLabel').textContent = mode === 'game' ? 'THE PLAYGROUND' : 'YOUR SOLUTION, IN MOTION';
      $('gameMode').setAttribute('aria-pressed', String(mode === 'game'));
      $('solveMode').setAttribute('aria-pressed', String(mode === 'solve'));
      $('gameMode').disabled = $('solveMode').disabled = busy || searching || playing;
      $('gamePanel').hidden = mode !== 'game';
      $('solvePanel').hidden = mode !== 'solve';
      $('palette').hidden = $('entryHelp').hidden = !editing();
      $('editorTitle').textContent = editing() ? 'Enter your own cube.' : 'Your cube, unfolded.';
      $('editorHint').textContent = editing() ? 'Pick a color → paint a sticker' : 'Live view · centers stay fixed';
      $('moveCount').textContent = turnCount;
      $('matchCount').textContent = `${[...gameCube.asString()].filter((c, i) => c === lab.solved[i]).length}/54`;
      for (const element of moveButtons) element.disabled = mode !== 'game' || busy;
      $('scramble').disabled = $('reset').disabled = busy;
      $('undo').disabled = busy || !history.length;
      $('findSolution').hidden = Boolean(moves) || searching;
      $('findSolution').disabled = searching || busy;
      $('cancelSearch').hidden = !searching;
      $('player').hidden = !moves;
      $('solveIntro').hidden = Boolean(moves);
      for (let index = 0; index < 54; index++) {
        const face = lab.faces[Math.floor(index / 9)], cell = index % 9, color = state[index];
        const tile = stickers[index];
        tile.dataset.color = color;
        tile.textContent = lab.letters[color];
        tile.disabled = !editing() || cell === 4;
        tile.setAttribute('aria-label', `${lab.names[face]} face, row ${Math.floor(cell / 3) + 1}, column ${cell % 3 + 1}: ${lab.colors[color]}${cell === 4 ? ' (fixed center)' : ''}`);
      }
      for (const { face, count, text } of countLabels) {
        const total = [...state].filter(color => color === face).length;
        text.textContent = `${lab.letters[face]} ${total}/9`;
        count.classList.toggle('invalid', total !== 9);
        count.setAttribute('aria-label', `${lab.colors[face]}: ${total} of 9 stickers`);
      }
      if (moves) {
        const done = position === moves.length;
        $('stepCount').textContent = `${position} of ${moves.length} turns complete`;
        $('nextMove').textContent = done ? '✓' : moves[position].replace("'", '′');
        $('instruction').textContent = done ? 'All six faces match. Your cube is solved!' : lab.describe(moves[position]);
        $('progress').max = Math.max(1, moves.length);
        $('progress').value = done ? Math.max(1, moves.length) : position;
        $('back').disabled = busy || playing || position === 0;
        $('next').disabled = busy || playing || done;
        $('play').disabled = done || (busy && !playing);
        $('play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
        $('replay').disabled = $('editCube').disabled = busy || playing;
        Array.from($('solutionMoves').children).forEach((element, index) => {
          element.classList.toggle('done', index < position);
          element.classList.toggle('current', index === position);
          if (index === position) element.setAttribute('aria-current', 'step');
          else element.removeAttribute('aria-current');
        });
      }
    }
    async function turn(cube, move, duration) {
      await renderer.animate(move, reducedMotion.matches ? 1 : duration);
      cube.move(move);
      renderer.setState(cube.asString());
    }
    async function playerTurn(move) {
      if (mode !== 'game' || busy) return;
      busy = true;
      render();
      await turn(gameCube, move, 300);
      history.push(move);
      if (history.length > 1000) history.shift();
      turnCount++;
      busy = false;
      status(gameCube.isSolved() ? `Solved! Nicely done — ${turnCount} player turns.` : lab.describe(move));
      render();
    }
    function pause(message = true) {
      playing = false;
      clearTimeout(timer);
      if (message) status(busy ? 'Pausing after this turn…' : 'Paused. Take your time, or use Next for one turn.');
      render();
    }
    function setMode(nextMode) {
      if (busy || searching || playing || mode === nextMode) return;
      mode = nextMode;
      if (mode === 'solve') {
        draft = gameCube.asString();
        moves = null;
        solveCube = null;
      }
      status(mode === 'game' ? 'Your game is ready. Use a face button or the keyboard to turn.' : 'Use this cube or paint your own below, then choose Find solution.');
      render();
    }
    function resetDraft(state) {
      if (busy || searching || playing) return;
      draft = state;
      moves = null;
      solveCube = null;
      position = 0;
      status('Match the stickers on your cube, then choose Find solution.');
      render();
    }
    async function step(direction = 1) {
      if (!moves || busy || (direction > 0 ? position >= moves.length : position === 0)) return;
      const seconds = Number($('speed').value);
      const duration = Math.min(1100, seconds * 450);
      const move = direction > 0 ? moves[position] : lab.inverse(moves[position - 1]);
      busy = true;
      renderer.setHighlight(move[0]);
      status(lab.describe(move));
      render();
      // Backward playback highlights the face actually being undone.
      renderer.setHighlight(move[0]);
      await turn(solveCube, move, duration);
      position += direction;
      busy = false;
      if (position === moves.length) {
        playing = false;
        status('Solved! Replay the solution, edit another cube, or return to your game.');
      } else if (!playing) status('Paused. Compare your cube with the map, then continue when ready.');
      render();
      if (playing) timer = setTimeout(() => step(), Math.max(100, seconds * 1000 - (reducedMotion.matches ? 1 : duration)));
    }
    $('gameMode').addEventListener('click', () => setMode('game'));
    $('solveMode').addEventListener('click', () => setMode('solve'));
    $('resetView').addEventListener('click', () => renderer.resetView());
    $('scramble').addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      history = [];
      turnCount = 0;
      gameCube = new Cube();
      const sequence = lab.scramble();
      $('scrambleText').textContent = sequence.join(' ');
      status('Mixing the cube with 25 random turns…');
      render();
      for (const move of sequence) await turn(gameCube, move, 75);
      busy = false;
      status('Scrambled. The next move is yours.');
      render();
    });
    $('undo').addEventListener('click', async () => {
      if (busy || !history.length) return;
      busy = true;
      render();
      await turn(gameCube, lab.inverse(history.pop()), 300);
      turnCount = Math.max(0, turnCount - 1);
      busy = false;
      status('Last player turn undone.');
      render();
    });
    $('reset').addEventListener('click', () => {
      if (busy) return;
      gameCube = new Cube();
      history = [];
      turnCount = 0;
      $('scrambleText').textContent = 'No scramble yet.';
      status('Cube reset. Try a scramble or explore the turns.');
      render();
    });
    $('findSolution').addEventListener('click', async () => {
      if (busy || searching || moves) return;
      const result = lab.validate(draft);
      if (!result.ok) { status(result.error, true); return; }
      searching = true;
      status('Starting the solver…');
      render();
      try {
        const solution = result.cube.isSolved() ? [] : await solver.solve(draft, message => status(message));
        if (!result.cube.clone().move(solution.join(' ')).isSolved()) throw new Error('The solution could not be verified. Please try again.');
        moves = solution;
        solveCube = result.cube;
        solutionStart = draft;
        position = 0;
        $('solutionMoves').replaceChildren();
        for (const move of moves) {
          const token = document.createElement('span');
          token.textContent = move.replace("'", '′');
          $('solutionMoves').append(token);
        }
        status(moves.length ? `Found a ${moves.length}-turn solution. Hold your cube with white up and green in front, then press Play or Next.` : 'This cube is already solved. Edit the cube or try a scramble in Play mode.');
      } catch (error) {
        status(error.message, true);
      } finally {
        searching = false;
        render();
      }
    });
    $('cancelSearch').addEventListener('click', () => solver.cancel());
    $('play').addEventListener('click', () => {
      if (playing) { pause(); return; }
      if (busy || !moves || position === moves.length) return;
      playing = true;
      step();
    });
    $('next').addEventListener('click', () => { if (!playing) step(); });
    $('back').addEventListener('click', () => { if (!playing) step(-1); });
    $('speed').addEventListener('input', () => { $('speedValue').textContent = `${$('speed').value} seconds`; });
    $('replay').addEventListener('click', () => {
      if (busy || playing) return;
      solveCube = Cube.fromString(solutionStart);
      position = 0;
      status('Back at the starting cube. Press Play or Next when you are ready.');
      render();
    });
    $('editCube').addEventListener('click', () => resetDraft(solveCube.asString()));
    $('useGame').addEventListener('click', () => resetDraft(gameCube.asString()));
    $('clearEntry').addEventListener('click', () => resetDraft(lab.solved));
    document.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
      const face = event.key.toUpperCase();
      if (mode === 'game' && lab.faces.includes(face)) {
        event.preventDefault();
        playerTurn(face + (event.shiftKey ? "'" : ''));
      } else if (event.code === 'Space' && mode === 'solve' && moves && !/^(BUTTON|SUMMARY)$/.test(event.target.tagName)) {
        event.preventDefault();
        $('play').click();
      }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });
    window.addEventListener('pagehide', () => { pause(false); solver.cancel(); });
    render();
  } catch {
    status('The cube could not load. Enable JavaScript in a modern browser and reload the page.', true);
    for (const element of document.querySelectorAll('button')) element.disabled = true;
  }
})();
