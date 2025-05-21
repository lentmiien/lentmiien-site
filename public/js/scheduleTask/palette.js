window.schedulePalette = {
  async getPalette() {
    let pal = localStorage.getItem('schedulePalette');
    if (pal) return JSON.parse(pal);
    const p = await fetch('/scheduleTask/api/palette').then(r => r.json());
    localStorage.setItem('schedulePalette', JSON.stringify(p));
    return p;
  },
  invalidateCache() {
    localStorage.removeItem('schedulePalette');
  }
}
