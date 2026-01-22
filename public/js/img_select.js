const CATEGORIES = [
  { key:'a', label:'Sting / Burn (skin-level)', color:'#FFD700', border:'#866F10'},
  { key:'b', label:'Aching / Tender (deep sore)', color:'#FF4B60', border:'#7E262F'},
  { key:'c', label:'Tight / Stiff (movement-related)', color:'#1E90FF', border:'#164075'},
  { key:'d', label:'Head Pressure / Throb', color:'#B455FF', border:'#5B277D'},
  { key:'e', label:'Queasy / Off (stomach + whole-body unwell)', color:'#FFEC80', border:'#BCAA43'}
];
function getCategory(k) {
  return CATEGORIES.find(c=>c.key===k) || CATEGORIES[0];
}
const categorySelect = document.getElementById('pe-category');
function fillCategorySelector() {
  categorySelect.innerHTML = "";
  CATEGORIES.forEach(cat=>{
    let opt = document.createElement('option');
    opt.value = cat.key;
    opt.innerText = cat.label;
    opt.style.backgroundColor = cat.color;
    opt.style.color = '#222';
    categorySelect.appendChild(opt);
  });
}
function getRelativeCoords(evt, element) {
  let rect = element.getBoundingClientRect();
  let x=0, y=0;
  if(evt.touches) {
    x = evt.touches[0].clientX - rect.left;
    y = evt.touches[0].clientY - rect.top;
  } else {
    x = evt.clientX - rect.left;
    y = evt.clientY - rect.top;
  }
  x = Math.min(Math.max(x, 0), rect.width);
  y = Math.min(Math.max(y, 0), rect.height);
  return {
    x: +(x / rect.width).toFixed(4),
    y: +(y / rect.height).toFixed(4),
    px: Math.round(x),
    py: Math.round(y)
  };
}
const state = {
  points: [], // {x, y, radius, opacity, category}
  selected: -1,
  imageSize: {w: 350, h: 200},
  date: "",
  isLoading: false
};
const imgWrap = document.getElementById('pe-img-wrap');
const img = document.getElementById('pe-img');
const overlay = document.getElementById('pe-points-overlay');
const hitbox = document.getElementById('pe-img-hitbox');
const radiusSlider = document.getElementById('pe-radius');
const opacitySlider = document.getElementById('pe-opacity');
const radiusVal = document.getElementById('pe-radius-val');
const opacityVal = document.getElementById('pe-opacity-val');
const pointList = document.getElementById('pe-point-list');
const dateInput = document.getElementById('pe-date');
const btnLoad = document.getElementById('pe-load');
const btnSave = document.getElementById('pe-save');
const btnClear = document.getElementById('pe-clear');
const btnDelete = document.getElementById('pe-delete');

function updateImageSize() {
  state.imageSize.w = img.naturalWidth ? img.width : 350;
  state.imageSize.h = img.naturalHeight ? img.height : 200;
}
img.addEventListener('load', updateImageSize);
window.addEventListener('resize', updateImageSize);

function renderOverlayPoints() {
  overlay.innerHTML = "";
  state.points.forEach((pt, i) => {
    const cat = getCategory(pt.category);
    const el = document.createElement('div');
    el.className = 'point' + (i===state.selected?' selected':'');
    let w = imgWrap.offsetWidth, h = imgWrap.offsetHeight;
    el.style.left = (pt.x * w + pt.radius - 1) + 'px';
    el.style.top = (pt.y * h + pt.radius - 1) + 'px';
    el.style.width = (pt.radius * 2) + 'px';
    el.style.height = (pt.radius * 2) + 'px';
    // el.style.marginLeft = (-pt.radius) + 'px';
    // el.style.marginTop = (-pt.radius) + 'px';
    el.style.background = cat.color;
    el.style.opacity = pt.opacity / 100;
    el.style.borderColor = pt.opacity>=75?'#fff':cat.border;
    el.style.borderWidth = '2.5px';
    overlay.appendChild(el);
  });
}
function renderPointList() {
  pointList.innerHTML = "";
  let add = document.createElement('div');
  add.className = 'point-item-add' + (state.selected===-1?' selected':'');
  add.innerText = 'Add new point';
  add.tabIndex = 0;
  add.onclick = ()=>selectPoint(-1);
  add.onkeydown = ev => { if(ev.key==='Enter') selectPoint(-1);}
  pointList.appendChild(add);
  state.points.forEach((pt, i) => {
    const cat = getCategory(pt.category);
    let row = document.createElement('div');
    row.className = 'point-item' + (state.selected===i?' selected':'');
    row.tabIndex = 0;
    row.innerHTML = `<span class="cat-dot" style="background:${cat.color};border-color:${cat.border};"></span>
      ${cat.label} &nbsp;@ (<span style="font-family:monospace">${Math.round(pt.x*100)},${Math.round(pt.y*100)}</span>),
      R=${pt.radius}, O=${pt.opacity}%`;
    row.onclick = ()=>selectPoint(i);
    row.onkeydown = ev => { if(ev.key==='Enter') selectPoint(i);}
    pointList.appendChild(row);
  });
}
function renderSlidersAndCategory() {
  let pt = state.points[state.selected] || {radius:7, opacity:80, category:CATEGORIES[0].key};
  radiusSlider.value = pt.radius;
  opacitySlider.value = pt.opacity;
  radiusSlider.disabled = (state.selected<0);
  opacitySlider.disabled = (state.selected<0);
  radiusVal.innerText = pt.radius;
  opacityVal.innerText = pt.opacity+'%';
  categorySelect.value = pt.category || CATEGORIES[0].key;
  categorySelect.disabled = state.selected==-1;
}
function renderAll() {
  renderOverlayPoints();
  renderPointList();
  renderSlidersAndCategory();
  btnDelete.disabled = (state.selected < 0);
}
function selectPoint(idx) {
  state.selected = idx;
  renderAll();
}
function addPointAt(x, y) {
  let point = {
    x, y,
    radius: Number(radiusSlider.value)||7,
    opacity: Number(opacitySlider.value)||80,
    category: categorySelect.value || CATEGORIES[0].key
  };
  state.points.push(point);
  state.selected = state.points.length-1;
  renderAll();
}
function moveSelectedPointTo(x, y) {
  if(state.selected<0) return;
  let pt = state.points[state.selected];
  pt.x = x; pt.y = y;
  renderAll();
}
function updateSelectedRadius(val) {
  const idx = state.selected;
  if(idx<0) return;
  state.points[idx].radius = Number(val)||7;
  renderAll();
}
function updateSelectedOpacity(val) {
  const idx = state.selected;
  if(idx<0) return;
  state.points[idx].opacity = Number(val)||80;
  renderAll();
}
function updateSelectedCategory(val) {
  const idx = state.selected;
  if(idx<0) return;
  state.points[idx].category = val;
  renderAll();
}
function imageHitboxHandler(evt) {
  let rel = getRelativeCoords(evt, imgWrap);
  evt.preventDefault();
  if(state.selected===-1) {
    addPointAt(rel.x, rel.y);
  } else if(state.selected>=0) {
    moveSelectedPointTo(rel.x, rel.y);
  }
}
hitbox.addEventListener('click', imageHitboxHandler);
hitbox.addEventListener('touchstart', function(e){
  if (e.touches.length===1) imageHitboxHandler(e);
}, {passive:false});
radiusSlider.addEventListener('input', function() {
  updateSelectedRadius(this.value);
});
opacitySlider.addEventListener('input', function() {
  updateSelectedOpacity(this.value);
});
categorySelect.addEventListener('change', function() {
  if(state.selected>=0) updateSelectedCategory(this.value);
});
dateInput.valueAsDate = new Date();
state.date = dateInput.value;
dateInput.addEventListener('change', () => {
  state.date = dateInput.value;
});
btnClear.addEventListener('click', clearAllPoints);
btnLoad.addEventListener('click', loadFromAPI);
btnSave.addEventListener('click', saveToAPI);
btnDelete.addEventListener('click', function() {
  if (state.selected >= 0) {
    if(confirm("Delete this point?")) {
      state.points.splice(state.selected, 1);
      state.selected = -1;
      renderAll();
    }
  }
});
async function apiSave(dateStr, points) {
  const payload = {
    type: 'visual_log',
    label: 'body_map',
    timestamp: dateStr ? new Date(`${dateStr}T12:00:00`).toISOString() : undefined,
    v_log_data: JSON.stringify({
      version: 1,
      image: '/i/img_select.jpg',
      canvas: { width: imgWrap.offsetWidth || 350, height: imgWrap.offsetHeight || 200 },
      points: points || [],
    }),
  };

  try {
    const resp = await fetch('/mypage/life_log/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    const contentType = resp.headers.get('content-type') || '';
    if (!resp.ok || resp.redirected || !contentType.includes('application/json')) {
      throw new Error('Unable to save visual log entry.');
    }
    return { ok: true, source: 'api' };
  } catch (error) {
    localStorage.setItem('point-editor:' + dateStr, JSON.stringify(points || []));
    return { ok: true, source: 'local' };
  }
}

async function apiLoad(dateStr) {
  let pts = [];
  try {
    const start = new Date(`${dateStr}T00:00:00`);
    const end = new Date(`${dateStr}T23:59:59`);
    const params = new URLSearchParams({
      type: 'visual_log',
      start: start.toISOString(),
      end: end.toISOString(),
      limit: '1',
    });
    const resp = await fetch(`/mypage/life_log/entries?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
    });
    const contentType = resp.headers.get('content-type') || '';
    if (!resp.ok || resp.redirected || !contentType.includes('application/json')) {
      throw new Error('Unable to load visual log entry.');
    }
    const data = await resp.json();
    const entry = Array.isArray(data.entries) ? data.entries[0] : null;
    if (entry && entry.v_log_data) {
      const parsed = JSON.parse(entry.v_log_data);
      pts = parsed.points || [];
      return { ok: true, points: pts, source: 'api' };
    }
  } catch (error) {
    try {
      pts = JSON.parse(localStorage.getItem('point-editor:' + dateStr) || '[]');
    } catch (e) {
      pts = [];
    }
  }
  return { ok: true, points: pts, source: 'local' };
}
function loadFromAPI() {
  if(state.isLoading) return;
  state.isLoading = true;
  let dateKey = dateInput.value;
  if(!dateKey) { alert("Pick a date"); state.isLoading = false; return; }
  apiLoad(dateKey).then(resp=>{
    state.points = resp.points || [];
    state.selected = -1;
    renderAll();
    state.isLoading = false;
  });
}
function saveToAPI() {
  let dateKey = dateInput.value;
  if(!dateKey) { alert("Pick a date to save."); return; }
  apiSave(dateKey, state.points).then(resp=>{
    if (resp.source === 'local') {
      alert("Saved locally (login required for database).");
    } else {
      alert("Saved!");
    }
  });
}
function clearAllPoints() {
  if(confirm('Clear all points for this date?')) {
    state.points = [];
    state.selected = -1;
    renderAll();
  }
}
window.onload = function(){
  fillCategorySelector();
  renderAll();
  updateImageSize();
};
