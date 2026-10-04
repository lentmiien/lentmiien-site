'use strict';

document.getElementById('reloadButton').addEventListener('click', () => location.reload());
import('./main.js').catch(() => {
  document.getElementById('failure').hidden = false;
  document.getElementById('beginButton').disabled = true;
  document.getElementById('playButton').disabled = true;
});
