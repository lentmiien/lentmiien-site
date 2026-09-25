/* Static, fully public client. No network writes, persistence or test hooks. */
(async function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const fail = message => {
    $('loading').hidden = true;
    $('menu').hidden = true;
    $('flightUI').hidden = true;
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    $('failure').hidden = false;
    $('failureText').textContent = message;
  };
  $('reload').onclick = () => location.reload();
  try {
    if (!window.SkyWorld || !window.SkyFlight || !window.SkyInput) throw new Error('missing assets');
    const W = window.SkyWorld,
      F = window.SkyFlight;
    const {
      FlightRenderer
    } = await import('./renderer.mjs');
    const renderer = new FlightRenderer($('scene'));
    const sim = new F.Simulation(),
      input = new window.SkyInput.Input();
    let playing = false,
      far = false,
      last = performance.now(),
      hudTime = 0,
      ended = false;
    const narration = new Audio('assets/audio/briefing.wav');
    narration.preload = 'none';
    const stopVoice = () => {
      narration.pause();
      narration.currentTime = 0;
      $('listen').textContent = '▶ Listen to briefing';
      $('listen').setAttribute('aria-pressed', 'false');
    };
    function clearInput() {
      input.clear();
      document.querySelectorAll('#touch .active').forEach(b => b.classList.remove('active'));
    }
    function pause() {
      clearInput();
      sim.pause(true);
      stopVoice();
    }
    function modalOpen() {
      return !!document.querySelector('dialog[open]');
    }
    function resume() {
      clearInput();
      sim.pause(false);
      last = performance.now();
    }
    function showHelp() {
      if (playing) pause();
      $('helpDialog').showModal();
    }
    function exitDialog(id) {
      $(id).close();
      if (playing && !modalOpen() && !ended) resume();
    }
    $('help').onclick = $('helpMenu').onclick = showHelp;
    $('closeHelp').onclick = () => exitDialog('helpDialog');
    $('closeMap').onclick = () => exitDialog('mapDialog');
    $('pause').onclick = () => {
      pause();
      $('pauseDialog').showModal();
    };
    $('resume').onclick = () => exitDialog('pauseDialog');
    document.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel', e => {
      e.preventDefault();
      if (d.id === 'debrief') return;
      exitDialog(d.id);
    }));
    $('listen').onclick = async () => {
      if (!narration.paused) return stopVoice();
      $('audioCaption').hidden = false;
      try {
        await narration.play();
        $('listen').textContent = '■ Stop briefing';
        $('listen').setAttribute('aria-pressed', 'true');
      } catch {
        $('listen').textContent = 'Audio unavailable · read below';
      }
    };
    narration.addEventListener('ended', stopVoice);
    const chart = document.createElement('canvas');
    chart.width = 280;
    chart.height = 280;
    const ctx = chart.getContext('2d');
    for (let y = 0; y < 280; y++) for (let x = 0; x < 280; x++) {
      const wx = (x / 280 - .5) * W.SIZE,
        wz = (y / 280 - .5) * W.SIZE,
        h = W.height(wx, wz);
      ctx.fillStyle = h < 0 ? '#315964' : h < 8 ? '#c1b18a' : h > 700 ? '#9fa99c' : h > 420 ? '#657e70' : wx > 3000 && wz < -2000 ? '#a18864' : '#657f61';
      ctx.fillRect(x, y, 1, 1);
    }
    function drawMap(canvas, flight = true, labels = true) {
      const c = canvas.getContext('2d'),
        w = canvas.width,
        h = canvas.height;
      c.fillStyle = '#171f25';
      c.fillRect(0, 0, w, h);
      const scale = Math.min(w, h) * .88 / W.SIZE,
        ox = w / 2,
        oy = h / 2;
      const pos = p => ({
        x: ox + p.x * scale,
        y: oy + p.z * scale
      });
      c.drawImage(chart, ox - W.HALF * scale, oy - W.HALF * scale, W.SIZE * scale, W.SIZE * scale);
      c.strokeStyle = '#ffffff12';
      c.lineWidth = 1;
      for (let n = -12000; n <= 12000; n += 4000) {
        c.beginPath();
        c.moveTo(ox + n * scale, oy - W.HALF * scale);
        c.lineTo(ox + n * scale, oy + W.HALF * scale);
        c.stroke();
      }
      const dep = flight ? sim.departure : W.airports.find(a => a.id === $('departure').value);
      const dest = flight ? sim.destination : W.airports.find(a => a.id === $('destination').value);
      const gate = W.point(dest, -dest.length / 2 - 3200),
        start = pos(flight ? sim.state : dep),
        g = pos(gate),
        end = pos(dest);
      c.strokeStyle = '#ffc247';
      c.setLineDash([5, 5]);
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(start.x, start.y);
      c.lineTo(g.x, g.y);
      c.lineTo(end.x, end.y);
      c.stroke();
      c.setLineDash([]);
      c.strokeRect(g.x - 4, g.y - 4, 8, 8);
      for (const a of W.airports) {
        const p = pos(a),
          p1 = pos(W.point(a, -700)),
          p2 = pos(W.point(a, 700));
        c.strokeStyle = a === dest ? '#ffc247' : '#e8ecf2';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(p1.x, p1.y);
        c.lineTo(p2.x, p2.y);
        c.stroke();
        c.fillStyle = '#e8ecf2';
        c.font = `${labels ? 12 : canvas.id === 'dispatchMap' ? 14 : 9}px system-ui`;
        c.textAlign = 'center';
        c.fillText(labels ? a.name : a.code, p.x, p.y - 10);
        if (labels) {
          c.fillStyle = '#ffc247';
          c.font = '10px monospace';
          c.fillText(`RWY ${W.runwayNumber(a.heading)} / ${a.elevation} m`, p.x, p.y + 17);
        }
      }
      if (flight) {
        const p = pos(sim.state);
        c.save();
        c.translate(p.x, p.y);
        c.rotate(sim.state.heading * W.DEG);
        c.fillStyle = '#ff6a1f';
        c.strokeStyle = '#fff0cc';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(0, -8);
        c.lineTo(6, 6);
        c.lineTo(0, 3);
        c.lineTo(-6, 6);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      }
      c.fillStyle = '#e8ecf2';
      c.textAlign = 'left';
      c.font = '10px monospace';
      c.fillText('N ↑', 12, 18);
      c.fillStyle = '#ffc247';
      c.fillRect(12, h - 18, 5000 * scale, 2);
      c.fillText('5 km', 12, h - 23);
    }
    for (const a of W.airports) for (const id of ['departure', 'destination']) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      $(id).append(opt);
    }
    $('departure').value = 'haven';
    $('destination').value = 'meadow';
    function selection() {
      if ($('departure').value === $('destination').value) $('destination').value = W.airports.find(a => a.id !== $('departure').value).id;
      for (const o of $('destination').options) o.disabled = o.value === $('departure').value;
      const a = W.airports.find(a => a.id === $('departure').value),
        b = W.airports.find(a => a.id === $('destination').value),
        km = Math.hypot(a.x - b.x, a.z - b.z) / 1000;
      $('routeInfo').textContent = `${km.toFixed(1)} km direct · about ${a.id === 'haven' && b.id === 'meadow' ? '2–4' : `${Math.round(km / 3.3 + 1)}–${Math.round(km / 3.3 + 5)}`} min · arrival RWY ${W.runwayNumber(b.heading)}`;
      $('routeNote').textContent = a.id === 'haven' && b.id === 'meadow' ? 'Recommended first flight: straight east, level terrain, generous approaches. Learn to take off and land before exploring farther.' : `${a.region} → ${b.region}. Navigate via the arrival gate, then turn onto ${b.heading || 360}°. Allow room for a circuit.`;
      drawMap($('dispatchMap'), false, false);
    }
    $('departure').onchange = $('destination').onchange = selection;
    function start() {
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
      stopVoice();
      sim.restart($('departure').value, $('destination').value);
      renderer.route(sim.destination);
      clearInput();
      playing = true;
      ended = false;
      $('menu').hidden = true;
      $('flightUI').hidden = false;
      $('routeLabel').textContent = `${sim.departure.code} → ${sim.destination.code}`;
      last = performance.now();
      updateHUD();
      $('start').blur();
    }
    function dispatch() {
      pause();
      playing = false;
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
      $('flightUI').hidden = true;
      $('menu').hidden = false;
      selection();
    }
    $('start').onclick = $('retry').onclick = $('retryPause').onclick = start;
    $('next').onclick = () => {
      if (sim.state.status === 'complete') {
        $('departure').value = sim.destination.id;
        $('destination').value = W.airports.find(a => a.id !== sim.destination.id).id;
      }
      dispatch();
    };
    $('dispatchPause').onclick = dispatch;
    $('camera').onclick = () => {
      far = !far;
    };
    function showMap() {
      pause();
      drawMap($('largeMap'));
      $('mapDetail').textContent = `${sim.destination.name} · runway ${W.runwayNumber(sim.destination.heading)} (${sim.destination.heading || 360}°) · elevation ${sim.destination.elevation} m ASL. Gold square: arrival gate, 3.2 km before threshold. All runways 1,400 × 64 m. The orange arrow is your aircraft.`;
      $('mapDialog').showModal();
    }
    $('mapButton').onclick = showMap;
    function updateHUD() {
      const s = sim.state,
        g = F.guidance(sim);
      const instrument = (id, number, unit) => {
        const strong = $(id);
        strong.replaceChildren(document.createTextNode(number + ' '));
        const i = document.createElement('i');
        i.textContent = unit;
        strong.append(i);
      };
      instrument('speed', s.speed.toFixed(0), 'm/s');
      instrument('altitude', Math.round(s.y), 'm ASL');
      instrument('vertical', (s.vs >= 0 ? '+' : '') + s.vs.toFixed(1), 'm/s');
      instrument('throttle', Math.round(s.throttle * 100), '%');
      $('agl').textContent = `${Math.max(0, Math.round(g.agl))} m AGL · above ground`;
      $('bank').textContent = `BANK ${Math.abs(s.bank).toFixed(0)}° · ${Math.abs(s.bank) < 3 ? 'LEVEL' : s.bank > 0 ? 'RIGHT' : 'LEFT'}`;
      $('brake').textContent = s.brake ? 'BRAKE HELD' : 'BRAKE RELEASED';
      $('brake').classList.toggle('warning', s.brake);
      $('power').value = s.throttle * 100;
      $('pitchValue').textContent = `PITCH ${s.pitch >= 0 ? '+' : ''}${s.pitch.toFixed(1)}°`;
      $('horizon').style.transform = `rotate(${s.bank}deg) translateY(${s.pitch * 1.4}px)`;
      $('navHeading').textContent = `HDG ${String(Math.round(s.heading) || 360).padStart(3, '0')}°`;
      $('navBearing').textContent = `GATE ${String(Math.round(g.bearing) || 360).padStart(3, '0')}°`;
      $('navDistance').textContent = `${(g.distance / 1000).toFixed(1)} km ${sim.destination.code}`;
      $('stage').textContent = g.stage.toUpperCase().replace('-', ' ');
      $('cueTitle').textContent = g.title;
      $('cue').textContent = g.cue;
      $('pathInfo').textContent = g.final || g.stage === 'lineup' ? `RUNWAY ${W.runwayNumber(sim.destination.heading)} · COURSE ${sim.destination.heading || 360}° · CENTRELINE ${Math.abs(g.cross).toFixed(0)} m ${g.cross > 0 ? 'LEFT' : 'RIGHT'}` : '';
      $('targets').textContent = `PITCH ${g.targetPitch > 0 ? '+' : ''}${g.targetPitch}° · POWER ${Math.round(g.targetThrottle * 100)}%`;
      drawMap($('miniMap'), true, false);
    }
    function debrief() {
      ended = true;
      clearInput();
      stopVoice();
      const s = sim.state,
        t = s.touchdown;
      $('resultLabel').textContent = s.status === 'complete' ? 'FLIGHT COMPLETE / WELL FLOWN' : s.status === 'diverted' ? 'SAFE DIVERSION / ROUTE INCOMPLETE' : 'FLIGHT ENDED / TRY AGAIN';
      $('resultTitle').textContent = s.status === 'complete' ? `Welcome to ${sim.destination.name}.` : s.status === 'diverted' ? 'A safe stop, a different arrival.' : 'Back to the flying club.';
      $('resultReason').textContent = s.reason;
      const entries = [['Flight time', `${Math.floor(s.elapsed / 60)}m ${Math.floor(s.elapsed % 60)}s`], ['Distance flown', `${(s.distance / 1000).toFixed(2)} km`], ['Maximum altitude', `${Math.round(s.maxAltitude)} m ASL`], ['Maximum speed', `${s.maxSpeed.toFixed(1)} m/s`], ['Touchdown', t?.airport ? W.airports.find(a => a.id === t.airport).name : 'No runway landing'], ['Touchdown descent', t ? `${t.descent.toFixed(2)} m/s` : '—'], ['Touchdown speed', t ? `${t.speed.toFixed(1)} m/s` : '—'], ['Alignment / centreline', t?.airport ? `${t.alignment.toFixed(1)}° / ${Math.abs(t.cross).toFixed(1)} m` : '—'], ['Ground roll', `${s.groundRoll.toFixed(0)} m`], ['Landing quality', s.status === 'complete' ? `${Math.max(0, Math.round(100 - t.descent * 8 - Math.abs(t.cross) * .6 - t.alignment * 2))} / 100` : 'Route incomplete']];
      $('stats').replaceChildren();
      for (const [key, val] of entries) {
        const dt = document.createElement('dt'),
          dd = document.createElement('dd');
        dt.textContent = key;
        dd.textContent = val;
        $('stats').append(dt, dd);
      }
      $('debrief').showModal();
    }
    document.addEventListener('keydown', e => {
      if (!playing || modalOpen() || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (window.SkyInput.codes.has(e.code)) {
        e.preventDefault();
        input.key(e.code, true);
      }
      if (e.repeat) return;
      if (['KeyP', 'Escape'].includes(e.code)) {
        e.preventDefault();
        pause();
        $('pauseDialog').showModal();
      }
      if (e.code === 'KeyM') showMap();
      if (e.code === 'KeyH') showHelp();
      if (e.code === 'KeyC') far = !far;
    });
    document.addEventListener('keyup', e => {
      if (input.key(e.code, false) && playing) e.preventDefault();
    });
    for (const button of document.querySelectorAll('[data-key]')) {
      button.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (!playing || sim.state.paused || ended) return;
        button.setPointerCapture(e.pointerId);
        input.pointers.set(e.pointerId, button.dataset.key);
        button.classList.add('active');
      });
      const release = e => {
        input.pointers.delete(e.pointerId);
        button.classList.remove('active');
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    }
    function blurPause() {
      stopVoice();
      clearInput();
      if (playing && !ended) {
        pause();
        if (!modalOpen()) $('pauseDialog').showModal();
      }
    }
    window.addEventListener('blur', blurPause);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) blurPause();
    });
    window.addEventListener('resize', () => renderer.resize());
    $('scene').addEventListener('webglcontextlost', e => {
      e.preventDefault();
      pause();
      playing = false;
      fail('The graphics context was lost. Reload to start a fresh flight.');
    });
    window.addEventListener('error', () => {
      pause();
      playing = false;
      fail('A game resource failed. Reload the complete local game folder to try again.');
    });
    selection();
    renderer.route(sim.destination);
    $('start').disabled = false;
    $('loading').hidden = true;
    $('menu').hidden = false;
    function frame(now) {
      const dt = Math.min((now - last) / 1000, .1);
      last = now;
      try {
        if (playing && !ended) {
          sim.update(dt, input.values());
          hudTime += dt;
          if (hudTime > .1) {
            updateHUD();
            hudTime = 0;
          }
          if (sim.state.status !== 'flying') debrief();
        }
        renderer.render(sim.state, dt, far);
      } catch {
        playing = false;
        fail('The flight renderer stopped. Reload to prepare a new aircraft.');
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch {
    fail('Sky Harbor needs WebGL 2 and its complete local assets. Enable graphics acceleration and serve this folder over HTTP, then reload.');
  }
})();
