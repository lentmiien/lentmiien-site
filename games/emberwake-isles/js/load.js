/* Keep failed module/dependency loads visible instead of leaving a loading screen forever. */
import('./boot.js').catch(error => {
  document.getElementById('loading').hidden = true;
  document.getElementById('fatal').hidden = false;
  document.getElementById('fatalText').textContent = 'A local game module could not load. Serve the complete game folder over HTTP, then reload. Your saved slots are unchanged.';
  document.getElementById('reload').onclick = () => location.reload();
  console.error('Emberwake module loading failed', error);
});
