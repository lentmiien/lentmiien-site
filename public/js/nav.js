/* Native dialog provides modal focus containment, Escape and inert background. */
(() => {
  const dialog = document.getElementById('navbar');
  const toggle = document.getElementById('tools-toggle');
  const close = document.getElementById('tools-close');
  const search = document.getElementById('tools-search');
  let opener;
  function closeTools() { dialog?.close(); }
  function toggleNavbar() {
    if (!dialog) return;
    if (dialog.open) { closeTools(); return; }
    opener = document.activeElement;
    dialog.showModal();
    toggle?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
    search?.focus();
  }
  window.toggleNavbar = toggleNavbar;
  toggle?.addEventListener('click', toggleNavbar);
  close?.addEventListener('click', closeTools);
  dialog?.addEventListener('close', () => {
    toggle?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('no-scroll');
    if (opener?.isConnected) opener.focus();
  });
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase();
    let count = 0;
    dialog.querySelectorAll('[data-tool-search]').forEach(link => {
      link.hidden = !link.dataset.toolSearch.toLocaleLowerCase().includes(query);
      if (!link.hidden && link.dataset.toolId) count++;
    });
    dialog.querySelectorAll('.tools-subgroup, .tools-group').forEach(group => {
      group.hidden = !group.querySelector('[data-tool-search]:not([hidden])');
      if (query && !group.hidden) group.open = true;
    });
    document.getElementById('tools-search-status').textContent = query ? `${count} tools found` : '';
  });
  if (window.bootstrap?.Tooltip) document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new window.bootstrap.Tooltip(el));
})();
