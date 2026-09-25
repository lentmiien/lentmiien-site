(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api; else root.DescentWorld = api;
})(globalThis, function () {
  const rock = (x, w, h) => [[x - w / 2, 0], [x + w / 2, 0], [x + w * .38, h * .72], [x + w * .1, h], [x - w * .3, h * .88]];
  const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const stages = [
    { id: 'selene', name: 'Selene', subtitle: 'The quiet frontier', gravity: 2.4, goalY: 3, cruise: 19, theme: 'lunar', colors: [0x101d32, 0x7892a8, 0x354b67, 0xa7d8e8], obstacles: [rock(0, 9, 10)], briefing: 'A gentle first crossing. Rise above the central ridge, then brake early in the low gravity.' },
    { id: 'ochre', name: 'Ochre', subtitle: 'Sands of the long dusk', gravity: 3.7, goalY: 5, cruise: 24, theme: 'desert', colors: [0x382035, 0xd88e58, 0x754451, 0xffc58e], obstacles: [rock(-7, 8, 14), rock(8, 7, 17)], briefing: 'Two sandstone fins split the basin. Climb above both before crossing to the raised arrival pad.' },
    { id: 'verdant', name: 'Verdant', subtitle: 'A garden beyond the sun', gravity: 5.2, goalY: 4, cruise: 24, theme: 'garden', colors: [0x102f36, 0x497d70, 0x274e55, 0x9ee5b0], obstacles: [rock(-8, 9, 12), rock(8, 8, 16)], briefing: 'Ancient basalt breaks through a luminous valley. Hold a clear line above the two outcrops.' },
    { id: 'nacre', name: 'Nacre', subtitle: 'The frozen cathedral', gravity: 6.5, goalY: 6, cruise: 27, theme: 'ice', colors: [0x17233f, 0x8dcedc, 0x4b668f, 0xd3c6ff], obstacles: [rock(-10, 7, 18), rock(3, 8, 19), rock(13, 5, 13)], briefing: 'Ice needles reach into the aurora. Clear their tips, then make a controlled vertical descent.' },
    { id: 'cinder', name: 'Cinder', subtitle: 'Fire beneath the surface', gravity: 8.2, goalY: 4, cruise: 26, theme: 'volcanic', colors: [0x291c30, 0x735363, 0x392d49, 0xff9866], obstacles: [rock(-8, 10, 18), rock(9, 10, 16)], briefing: 'Heavy gravity demands longer burns. The dark volcanic ridges are solid; the glowing rear caldera is scenery.' },
    { id: 'atlas', name: 'Atlas', subtitle: 'The last working outpost', gravity: 9.8, goalY: 7, cruise: 27, theme: 'industrial', colors: [0x182c3b, 0x667c89, 0x334951, 0xffd08b], obstacles: [box(-13, 0, 6, 15), box(2, 0, 6, 19), box(12, 0, 4, 12)], briefing: 'Cross the refinery towers with the highest gravity of the expedition. Save room for a long braking burn.' }
  ].map((s, i) => Object.freeze({ ...s, index: i, fuel: 160, start: { x: -27, y: 3, width: 12, id: 'start' }, goal: { x: 27, y: s.goalY, width: 14, id: 'goal' }, bounds: { left: -39, right: 39, top: 48 } }));
  const getStage = id => {
    const stage = stages.find(s => s.id === id);
    if (!stage) throw new RangeError('Unknown planet');
    return stage;
  };
  return { stages, getStage, box };
});
