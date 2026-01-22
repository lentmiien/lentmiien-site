(() => {
  const lifeLogForm = document.getElementById('life-log-form');
  if (!lifeLogForm) return;

  const typeSelect = document.getElementById('life-log-type');
  const labelInput = document.getElementById('life-log-label');
  const valueInput = document.getElementById('life-log-value');
  const textInput = document.getElementById('life-log-text');
  const timestampInput = document.getElementById('life-log-timestamp');
  const valueRow = document.getElementById('life-log-value-row');
  const textRow = document.getElementById('life-log-text-row');
  const statusEl = document.getElementById('life-log-status');
  const formatBtn = document.getElementById('life-log-format');
  const transcribeBtn = document.getElementById('life-log-transcribe');
  const audioInput = document.getElementById('life-log-audio');

  const pad2 = (value) => String(value).padStart(2, '0');
  const formatDateTimeInput = (date) => {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  };

  const setStatus = (message, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#b02a37' : '';
  };

  const updateTypeRows = () => {
    const isDiary = typeSelect.value === 'diary';
    valueRow.style.display = isDiary ? 'none' : '';
    textRow.style.display = isDiary ? '' : 'none';
  };

  const collectPayload = () => {
    const payload = {
      type: typeSelect.value,
      label: labelInput.value.trim(),
      value: valueInput.value.trim(),
      text: textInput.value.trim(),
      timestamp: timestampInput.value,
    };
    if (!payload.timestamp) {
      delete payload.timestamp;
    }
    return payload;
  };

  const resetForm = () => {
    labelInput.value = '';
    valueInput.value = '';
    textInput.value = '';
    timestampInput.value = formatDateTimeInput(new Date());
  };

  timestampInput.value = formatDateTimeInput(new Date());
  updateTypeRows();

  typeSelect.addEventListener('change', updateTypeRows);

  document.querySelectorAll('.life-log-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const label = chip.getAttribute('data-label') || chip.textContent || '';
      labelInput.value = label.trim();
      labelInput.focus();
    });
  });

  lifeLogForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving...');
    const payload = collectPayload();

    try {
      const resp = await fetch('/mypage/life_log/entry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || 'Unable to save entry.');
      }
      setStatus('Saved.');
      resetForm();
    } catch (error) {
      setStatus(error.message || 'Unable to save entry.', true);
    }
  });

  if (formatBtn) {
    formatBtn.addEventListener('click', async () => {
      const text = textInput.value.trim();
      if (!text) {
        setStatus('Add diary text to format.', true);
        return;
      }
      setStatus('Formatting...');
      try {
        const resp = await fetch('/mypage/life_log/format', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ text }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data?.error || 'Unable to format text.');
        }
        textInput.value = data.formatted || text;
        setStatus('Formatted.');
      } catch (error) {
        setStatus(error.message || 'Unable to format text.', true);
      }
    });
  }

  if (transcribeBtn) {
    transcribeBtn.addEventListener('click', async () => {
      const file = audioInput?.files?.[0];
      if (!file) {
        setStatus('Select an audio file to transcribe.', true);
        return;
      }
      setStatus('Transcribing audio...');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source', 'upload');
      try {
        const resp = await fetch('/asr/transcribe', {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: formData,
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data?.error || 'Unable to transcribe audio.');
        }
        if (data?.result?.text) {
          textInput.value = data.result.text;
          setStatus('Transcription ready.');
        } else {
          setStatus('No transcript returned.', true);
        }
      } catch (error) {
        setStatus(error.message || 'Unable to transcribe audio.', true);
      }
    });
  }

  const visualLogState = {
    points: [],
    selected: -1,
    canvas: { width: 1, height: 1 },
  };

  const CATEGORIES = [
    { key:'a', label:'Sting / Burn (skin-level)', color:'#FFD700', border:'#866F10'},
    { key:'b', label:'Aching / Tender (deep sore)', color:'#FF4B60', border:'#7E262F'},
    { key:'c', label:'Tight / Stiff (movement-related)', color:'#1E90FF', border:'#164075'},
    { key:'d', label:'Head Pressure / Throb', color:'#B455FF', border:'#5B277D'},
    { key:'e', label:'Queasy / Off (stomach + whole-body unwell)', color:'#FFEC80', border:'#BCAA43'}
  ];

  const getCategory = (key) => CATEGORIES.find((cat) => cat.key === key) || CATEGORIES[0];

  const imgWrap = document.getElementById('llv-img-wrap');
  const img = document.getElementById('llv-img');
  const overlay = document.getElementById('llv-points-overlay');
  const hitbox = document.getElementById('llv-img-hitbox');
  const radiusSlider = document.getElementById('llv-radius');
  const opacitySlider = document.getElementById('llv-opacity');
  const radiusVal = document.getElementById('llv-radius-val');
  const opacityVal = document.getElementById('llv-opacity-val');
  const categorySelect = document.getElementById('llv-category');
  const pointList = document.getElementById('llv-point-list');
  const visualTimestamp = document.getElementById('llv-timestamp');
  const visualSave = document.getElementById('llv-save');
  const visualClear = document.getElementById('llv-clear');
  const visualDelete = document.getElementById('llv-delete');
  const visualStatus = document.getElementById('llv-status');

  if (imgWrap && img && overlay && hitbox) {
    const setVisualStatus = (message, isError = false) => {
      if (!visualStatus) return;
      visualStatus.textContent = message;
      visualStatus.style.color = isError ? '#b02a37' : '';
    };

    const fillCategorySelector = () => {
      if (!categorySelect) return;
      categorySelect.innerHTML = '';
      CATEGORIES.forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat.key;
        option.textContent = cat.label;
        option.style.backgroundColor = cat.color;
        option.style.color = '#222';
        categorySelect.appendChild(option);
      });
    };

    const updateCanvasSize = () => {
      const rect = imgWrap.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && visualLogState.canvas.width === 1) {
        visualLogState.canvas.width = rect.width;
        visualLogState.canvas.height = rect.height;
      }
      renderOverlayPoints();
    };

    const getRelativeCoords = (evt, element) => {
      const rect = element.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
      const y = Math.min(Math.max(clientY - rect.top, 0), rect.height);
      return {
        x: +(x / rect.width).toFixed(4),
        y: +(y / rect.height).toFixed(4),
      };
    };

    const renderOverlayPoints = () => {
      overlay.innerHTML = '';
      const rect = imgWrap.getBoundingClientRect();
      const scale = rect.width / (visualLogState.canvas.width || rect.width || 1);
      visualLogState.points.forEach((pt, index) => {
        const cat = getCategory(pt.category);
        const el = document.createElement('div');
        el.className = 'point' + (index === visualLogState.selected ? ' selected' : '');
        el.style.left = `${pt.x * rect.width}px`;
        el.style.top = `${pt.y * rect.height}px`;
        const radius = Math.max(2, (pt.radius || 8) * scale);
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

    const renderPointList = () => {
      pointList.innerHTML = '';
      const add = document.createElement('div');
      add.className = 'point-item-add' + (visualLogState.selected === -1 ? ' selected' : '');
      add.textContent = 'Add new point';
      add.tabIndex = 0;
      add.addEventListener('click', () => selectPoint(-1));
      add.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') selectPoint(-1);
      });
      pointList.appendChild(add);

      visualLogState.points.forEach((pt, index) => {
        const cat = getCategory(pt.category);
        const row = document.createElement('div');
        row.className = 'point-item' + (visualLogState.selected === index ? ' selected' : '');
        row.tabIndex = 0;
        row.innerHTML = `<span class="cat-dot" style="background:${cat.color};border-color:${cat.border};"></span>
          ${cat.label} @ (${Math.round(pt.x * 100)}, ${Math.round(pt.y * 100)})`;
        row.addEventListener('click', () => selectPoint(index));
        row.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') selectPoint(index);
        });
        pointList.appendChild(row);
      });
    };

    const renderControls = () => {
      const pt = visualLogState.points[visualLogState.selected] || {
        radius: 8,
        opacity: 80,
        category: CATEGORIES[0].key,
      };
      radiusSlider.value = pt.radius;
      opacitySlider.value = pt.opacity;
      radiusVal.textContent = `${pt.radius}px`;
      opacityVal.textContent = `${pt.opacity}%`;
      categorySelect.value = pt.category || CATEGORIES[0].key;
      const hasSelection = visualLogState.selected >= 0;
      radiusSlider.disabled = !hasSelection;
      opacitySlider.disabled = !hasSelection;
      categorySelect.disabled = !hasSelection;
      visualDelete.disabled = !hasSelection;
    };

    const renderAll = () => {
      renderOverlayPoints();
      renderPointList();
      renderControls();
    };

    const selectPoint = (index) => {
      visualLogState.selected = index;
      renderAll();
    };

    const addPointAt = (x, y) => {
      visualLogState.points.push({
        x,
        y,
        radius: Number(radiusSlider.value) || 8,
        opacity: Number(opacitySlider.value) || 80,
        category: categorySelect.value || CATEGORIES[0].key,
      });
      visualLogState.selected = visualLogState.points.length - 1;
      renderAll();
    };

    const moveSelectedPointTo = (x, y) => {
      if (visualLogState.selected < 0) return;
      visualLogState.points[visualLogState.selected].x = x;
      visualLogState.points[visualLogState.selected].y = y;
      renderAll();
    };

    const onHitbox = (evt) => {
      evt.preventDefault();
      const rel = getRelativeCoords(evt, imgWrap);
      if (visualLogState.selected === -1) {
        addPointAt(rel.x, rel.y);
      } else {
        moveSelectedPointTo(rel.x, rel.y);
      }
    };

    hitbox.addEventListener('click', onHitbox);
    hitbox.addEventListener('touchstart', (evt) => {
      if (evt.touches.length === 1) onHitbox(evt);
    }, { passive: false });

    radiusSlider.addEventListener('input', () => {
      if (visualLogState.selected < 0) return;
      visualLogState.points[visualLogState.selected].radius = Number(radiusSlider.value) || 8;
      renderAll();
    });

    opacitySlider.addEventListener('input', () => {
      if (visualLogState.selected < 0) return;
      visualLogState.points[visualLogState.selected].opacity = Number(opacitySlider.value) || 80;
      renderAll();
    });

    categorySelect.addEventListener('change', () => {
      if (visualLogState.selected < 0) return;
      visualLogState.points[visualLogState.selected].category = categorySelect.value;
      renderAll();
    });

    visualClear.addEventListener('click', () => {
      if (!confirm('Clear all points?')) return;
      visualLogState.points = [];
      visualLogState.selected = -1;
      renderAll();
      setVisualStatus('Cleared.');
    });

    visualDelete.addEventListener('click', () => {
      if (visualLogState.selected < 0) return;
      if (!confirm('Delete selected point?')) return;
      visualLogState.points.splice(visualLogState.selected, 1);
      visualLogState.selected = -1;
      renderAll();
      setVisualStatus('Point removed.');
    });

    visualTimestamp.value = formatDateTimeInput(new Date());

    visualSave.addEventListener('click', async () => {
      if (!visualLogState.points.length) {
        setVisualStatus('Add at least one point before saving.', true);
        return;
      }
      setVisualStatus('Saving visual log...');
      const payload = {
        type: 'visual_log',
        label: 'body_map',
        v_log_data: JSON.stringify({
          version: 1,
          image: '/i/img_select.jpg',
          canvas: { ...visualLogState.canvas },
          points: visualLogState.points,
        }),
        timestamp: visualTimestamp.value,
      };
      try {
        const resp = await fetch('/mypage/life_log/entry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data?.error || 'Unable to save visual log.');
        }
        setVisualStatus('Saved.');
        visualLogState.points = [];
        visualLogState.selected = -1;
        renderAll();
      } catch (error) {
        setVisualStatus(error.message || 'Unable to save visual log.', true);
      }
    });

    window.addEventListener('resize', updateCanvasSize);
    img.addEventListener('load', updateCanvasSize);

    fillCategorySelector();
    renderAll();
    updateCanvasSize();
  }
})();
