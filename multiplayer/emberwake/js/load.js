/* Keep failed module/dependency loads visible instead of leaving a loading screen forever. */
import('./boot.js').catch(error => {
  document.getElementById('welcome').hidden = true;
  document.getElementById('loading').hidden = true;
  document.getElementById('fatal').hidden = false;
  document.getElementById('fatalText').textContent = 'A harbor module could not load. Check your connection, then reopen the harbor.';
  document.getElementById('reload').onclick = () => location.reload();
  console.error('Emberwake module loading failed', error);
});
