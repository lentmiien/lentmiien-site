/* --- JS MODULE CODE BELOW --- */

// Utility to get coordinates relative to image
function getRelativeCoords(evt, element) {
  // Support touch and mouse
  let rect = element.getBoundingClientRect();
  let x=0, y=0;
  if(evt.touches) { // TouchEvent
    x = evt.touches[0].clientX - rect.left;
    y = evt.touches[0].clientY - rect.top;
  } else { // MouseEvent
    x = evt.clientX - rect.left;
    y = evt.clientY - rect.top;
  }
  // Clamp in image border
  x = Math.min(Math.max(x, 0), rect.width);
  y = Math.min(Math.max(y, 0), rect.height);
  return {
    x: +(x / rect.width).toFixed(4),
    y: +(y / rect.height).toFixed(4),
    px: Math.round(x),
    py: Math.round(y)
  };
}

// --- STATE ---
const state = {
  points: [],      // {x, y, radius, opacity}, each x/y in 0..1 relative
  selected: -1,    // -1 = 'add new', otherwise index into .points
  imageSize: {w:350, h:200},
  date: "",
  isLoading: false
};

// --- ELEMENTS ---
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

// ---- IMAGE DIMENSIONS ----
function updateImageSize() {
  // Called on load and on resize
  state.imageSize.w = img.naturalWidth ? img.width : 350;
  state.imageSize.h = img.naturalHeight ? img.height : 200;
}
img.addEventListener('load', updateImageSize);
window.addEventListener('resize', updateImageSize);

// --- RENDERERS ---
function renderOverlayPoints() {
  // Remove all
  overlay.innerHTML = "";
  state.points.forEach((pt, i) => {
    const el = document.createElement('div');
    el.className = 'point' + (i===state.selected ? ' selected' : '');
    // px, py based on current displayed image size
    let w = imgWrap.offsetWidth, h = imgWrap.offsetHeight;
    el.style.left = (pt.x * w + pt.radius - 1) + 'px';
    el.style.top = (pt.y * h + pt.radius - 1) + 'px';
    el.style.width = (pt.radius * 2) + 'px';
    el.style.height = (pt.radius * 2) + 'px';
    el.style.marginLeft = (-pt.radius) + 'px';
    el.style.marginTop = (-pt.radius) + 'px';
    el.style.background = `rgba(255,33,33,${pt.opacity/100})`;
    el.style.opacity = pt.opacity/100;
    // Could support drag here in future.
    overlay.appendChild(el);
  });
}
function renderPointList() {
  pointList.innerHTML = "";
  // AddNew element
  let add = document.createElement('div');
  add.className = 'point-item-add' + (state.selected===-1?' selected':'');
  add.innerText = 'Add new point';
  add.tabIndex = 0;
  add.onclick = ()=>selectPoint(-1);
  add.onkeydown = ev => { if(ev.key==='Enter') selectPoint(-1);}
  pointList.appendChild(add);
  // Points
  state.points.forEach((pt, i) => {
    let row = document.createElement('div');
    row.className = 'point-item' + (state.selected===i?' selected':'');
    row.tabIndex = 0;
    // px location (depends on rendered size)
    // We'll show rounded percent for x/y
    row.innerHTML = `Point @
      (<span style="font-family:monospace">${Math.round(pt.x*100)},${Math.round(pt.y*100)}</span>),
      R=${pt.radius},
      O=<span>${pt.opacity}%</span>`;
    row.onclick = ()=>selectPoint(i);
    row.onkeydown = ev => { if(ev.key==='Enter') selectPoint(i);}
    pointList.appendChild(row);
  });
}
function renderSliders() {
  // Set slider values or disable if no selection
  let pt = state.points[state.selected] || {radius:7, opacity:80};
  radiusSlider.value = pt.radius;
  opacitySlider.value = pt.opacity;
  radiusSlider.disabled = (state.selected<0);
  opacitySlider.disabled = (state.selected<0);
  radiusVal.innerText = pt.radius;
  opacityVal.innerText = pt.opacity+'%';
}
function renderAll() {
  renderOverlayPoints();
  renderPointList();
  renderSliders();
}

// -- Point selection and manipulation --
function selectPoint(idx) {
  state.selected = idx;
  renderAll();
}
function addPointAt(x, y) {
  // Default slider values
  let point = {
    x, y,
    radius: Number(radiusSlider.value)||7,
    opacity: Number(opacitySlider.value)||80
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

// ----- IMAGE INTERACTION -----
function imageHitboxHandler(evt) {
  let rel = getRelativeCoords(evt, imgWrap);
  evt.preventDefault();
  if(state.selected===-1) {
    // Add new
    addPointAt(rel.x, rel.y);
  } else if(state.selected>=0) {
    // Move selected
    moveSelectedPointTo(rel.x, rel.y);
  }
}
hitbox.addEventListener('click', imageHitboxHandler);
hitbox.addEventListener('touchstart', function(e){
  // Only react on quick tap (not drag)
  if (e.touches.length===1) imageHitboxHandler(e);
}, {passive:false});

// ---- SLIDERS ----
radiusSlider.addEventListener('input', function() {
  updateSelectedRadius(this.value);
});
opacitySlider.addEventListener('input', function() {
  updateSelectedOpacity(this.value);
});

// --- DATE HANDLING ---
dateInput.valueAsDate = new Date();
state.date = dateInput.value;
dateInput.addEventListener('change', () => {
  state.date = dateInput.value;
  // Optionally auto-load
  //loadFromAPI();
});

// ---- BUTTONS -----
btnClear.addEventListener('click', clearAllPoints);
btnLoad.addEventListener('click', loadFromAPI);
btnSave.addEventListener('click', saveToAPI);

// --- API DUMMY HANDLING (replace with real fetch!) ---
function apiSave(dateStr, points) {
  // Dummy: store in localStorage with date key
  localStorage.setItem('point-editor:'+dateStr, JSON.stringify(points));
  return Promise.resolve({ok:true});
}
function apiLoad(dateStr) {
  // Dummy: read from localStorage
  let pts = [];
  try {
    pts = JSON.parse(localStorage.getItem('point-editor:'+dateStr) || '[]');
  } catch(e) {}
  return Promise.resolve({ok:true, points:pts});
}

// --- LOAD/SAVE ---
function loadFromAPI() {
  if(state.isLoading) return;
  state.isLoading = true;
  let dateKey = dateInput.value;
  if(!dateKey) {
    alert("Pick a date");
    state.isLoading = false;
    return;
  }
  apiLoad(dateKey).then(resp=>{
    state.points = resp.points || [];
    state.selected = -1;
    renderAll();
    state.isLoading = false;
  });
}
function saveToAPI() {
  let dateKey = dateInput.value;
  if(!dateKey) {
    alert("Pick a date to save.");
    return;
  }
  // Could send an XHR/fetch here. For now, uses dummy.
  apiSave(dateKey, state.points).then(resp=>{
    alert("Saved!");
  });
}
function clearAllPoints() {
  if(confirm('Clear all points for this date?')) {
    state.points = [];
    state.selected = -1;
    renderAll();
  }
}

// --- INITIALIZE ---
window.onload = function(){
  renderAll();
  updateImageSize();
};
