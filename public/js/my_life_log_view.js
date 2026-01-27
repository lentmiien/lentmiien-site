(() => {
  const CATEGORIES = [
    { key:'a', label:'Sting / Burn (skin-level)', color:'#FFD700', border:'#866F10'},
    { key:'b', label:'Aching / Tender (deep sore)', color:'#FF4B60', border:'#7E262F'},
    { key:'c', label:'Tight / Stiff (movement-related)', color:'#1E90FF', border:'#164075'},
    { key:'d', label:'Head Pressure / Throb', color:'#B455FF', border:'#5B277D'},
    { key:'e', label:'Queasy / Off (stomach + whole-body unwell)', color:'#FFEC80', border:'#BCAA43'}
  ];

  const getCategory = (key) => CATEGORIES.find((cat) => cat.key === key) || CATEGORIES[0];

  const renderVisualLog = (wrapper) => {
    const overlay = wrapper.querySelector('.visual-log-overlay');
    if (!overlay) return;
    const raw = wrapper.getAttribute('data-vlog') || '';
    let data = wrapper._lifeLogData;
    if (!data) {
      try {
        data = JSON.parse(raw);
      } catch (error) {
        return;
      }
      wrapper._lifeLogData = data;
    }

    const points = Array.isArray(data?.points) ? data.points : [];
    const rect = wrapper.getBoundingClientRect();
    const baseWidth = data?.canvas?.width || rect.width || 1;
    const scale = rect.width / (baseWidth || rect.width || 1);

    overlay.innerHTML = '';
    points.forEach((pt) => {
      const cat = getCategory(pt.category);
      const el = document.createElement('div');
      el.className = 'point';
      const radius = Math.max(2, (pt.radius || 8) * scale);
      el.style.left = `${pt.x * rect.width}px`;
      el.style.top = `${pt.y * rect.height}px`;
      el.style.width = `${radius * 2}px`;
      el.style.height = `${radius * 2}px`;
      // el.style.marginLeft = `${-radius}px`;
      // el.style.marginTop = `${-radius}px`;
      el.style.background = cat.color;
      el.style.opacity = (pt.opacity || 80) / 100;
      el.style.borderColor = (pt.opacity || 80) >= 75 ? '#fff' : cat.border;
      el.style.borderWidth = '2px';
      overlay.appendChild(el);
    });
  };

  const visualLogs = Array.from(document.querySelectorAll('.visual-log-view'));
  visualLogs.forEach(renderVisualLog);
  window.addEventListener('resize', () => {
    visualLogs.forEach(renderVisualLog);
  });

  const layoutContainer = document.querySelector('.life-log-views');
  const layoutButtons = Array.from(document.querySelectorAll('[data-life-log-layout]'));
  const layoutStorageKey = 'lifeLogLayout';

  const setLayout = (layout) => {
    if (!layoutContainer) return;
    const nextLayout = layout === 'summary' ? 'summary' : 'timeline';
    layoutContainer.dataset.layout = nextLayout;
    layoutButtons.forEach((button) => {
      const isActive = button.getAttribute('data-life-log-layout') === nextLayout;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    try {
      localStorage.setItem(layoutStorageKey, nextLayout);
    } catch (error) {
      // Ignore storage failures (privacy mode, etc.).
    }
    requestAnimationFrame(() => {
      visualLogs.forEach(renderVisualLog);
    });
  };

  if (layoutContainer && layoutButtons.length) {
    let initialLayout = layoutContainer.dataset.layout || 'timeline';
    try {
      const storedLayout = localStorage.getItem(layoutStorageKey);
      if (storedLayout) {
        initialLayout = storedLayout;
      }
    } catch (error) {
      // Ignore storage failures (privacy mode, etc.).
    }
    setLayout(initialLayout);
    layoutButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setLayout(button.getAttribute('data-life-log-layout'));
      });
    });
  }

  const getEntryNodes = (entryId) => {
    if (!entryId) return [];
    const safeId = window.CSS && window.CSS.escape ? window.CSS.escape(entryId) : entryId;
    return document.querySelectorAll(`[data-entry-id=\"${safeId}\"]`);
  };

  const cleanupSummary = () => {
    document.querySelectorAll('.life-log-day-group').forEach((group) => {
      if (!group.querySelector('.life-log-entry')) {
        group.remove();
      }
    });
    document.querySelectorAll('.life-log-day').forEach((day) => {
      if (!day.querySelector('.life-log-entry')) {
        day.remove();
      }
    });
  };

  document.querySelectorAll('.life-log-delete').forEach((button) => {
    button.addEventListener('click', async () => {
      const entry = button.closest('.life-log-entry');
      if (!entry) return;
      const entryId = entry.getAttribute('data-entry-id');
      if (!entryId) return;
      const confirmDelete = window.confirm('Delete this entry?');
      if (!confirmDelete) return;

      button.disabled = true;
      try {
        const resp = await fetch(`/mypage/life_log/entry/${entryId}`, {
          method: 'DELETE',
          headers: { 'Accept': 'application/json' },
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data?.error || 'Unable to delete entry.');
        }
        getEntryNodes(entryId).forEach((node) => node.remove());
        cleanupSummary();
      } catch (error) {
        button.disabled = false;
        window.alert(error.message || 'Unable to delete entry.');
      }
    });
  });
})();
