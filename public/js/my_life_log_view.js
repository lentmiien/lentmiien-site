(() => {
  const CATEGORIES = [
    { key: 'a', label: 'Category A', color: '#FFD700', border: '#866F10' },
    { key: 'b', label: 'Category B', color: '#FF4B60', border: '#7E262F' },
    { key: 'c', label: 'Category C', color: '#1E90FF', border: '#164075' },
    { key: 'd', label: 'Category D', color: '#B455FF', border: '#5B277D' },
    { key: 'e', label: 'Category E', color: '#FFEC80', border: '#BCAA43' },
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

  document.querySelectorAll('.life-log-delete').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = button.closest('.life-log-item');
      if (!item) return;
      const entryId = item.getAttribute('data-entry-id');
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
        item.remove();
      } catch (error) {
        button.disabled = false;
        window.alert(error.message || 'Unable to delete entry.');
      }
    });
  });
})();
