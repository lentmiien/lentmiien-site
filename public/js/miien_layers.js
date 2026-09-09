((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiienLayers = factory();
})(typeof window === 'object' ? window : this, () => {
  'use strict';
  // All coordinates share the base canvas. Only the foreground breathes;
  // the stage background and independently masked facial regions stay registered.
  function create({ document, still, asset, onError }) {
    const element = document.createElement('div');
    element.className = 'character-layers';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', 'Miien with a neutral expression');
    const frame = document.createElement('div');
    frame.className = 'miien-rig';
    element.append(frame);
    const add = (item, name) => {
      const image = document.createElement('img');
      image.className = name; image.alt = ''; image.draggable = false;
      image.style.left = `${100 * item.x / asset.width}%`;
      image.style.top = `${100 * item.y / asset.height}%`;
      image.style.width = `${100 * item.width / asset.width}%`;
      image.style.height = `${100 * item.height / asset.height}%`;
      image.onerror = onError;
      image.src = item.src;
      frame.append(image);
      return image;
    };
    add(asset.base, 'miien-base');
    add(asset.blink, 'miien-blink');
    const small = add(asset.mouths.small, 'miien-mouth');
    const open = add(asset.mouths.open, 'miien-mouth');
    function mouth(value) { small.hidden = value !== 1; open.hidden = value !== 2; }
    mouth(0);
    still.after(element);
    return { mouth, dispose() { mouth(0); element.remove(); } };
  }
  return { create };
});
