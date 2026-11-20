/* =====================================================================
 * main.js — boot: canvas sizing, game loop, overlays
 * ===================================================================== */
window.Civ = window.Civ || {};
(function (Civ) {

  function resizeCanvas() {
    const c = document.getElementById('map');
    const wrap = document.getElementById('mapwrap');
    if (c && wrap) {
      c.width = wrap.clientWidth;
      c.height = wrap.clientHeight;
    }
  }

  window.addEventListener('load', function () {
    const canvas = document.getElementById('map');
    Civ.render.init(canvas);
    Civ.ui.initEvents();
    resizeCanvas();
    window.addEventListener('resize', function () { resizeCanvas(); if (Civ.state) Civ.render.draw(); });
    Civ.ui.showNewGame();

    let running = true;
    function loop() {
      if (!running) return;
      if (Civ.state) {
        Civ.render.draw();
        Civ.ui.checkWinner();
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });

})(window.Civ);
