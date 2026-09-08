function visualPayload(raw) {
  if (typeof raw !== 'string' || raw.length > 24000) throw new Error('Invalid visual log');
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.points) || value.points.length < 1 || value.points.length > 100) throw new Error('Invalid visual points');
  const number = (value, min, max) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid visual coordinate');
    return value;
  };
  return JSON.stringify({ version: 1, image: '/i/img_select.jpg',
    canvas: { width: number(value.canvas?.width, 1, 10000), height: number(value.canvas?.height, 1, 10000) },
    points: value.points.map(p => ({ x: number(p.x, 0, 1), y: number(p.y, 0, 1), radius: number(p.radius, 2, 28), opacity: number(p.opacity, 25, 100), category: ['a', 'b', 'c', 'd', 'e'].includes(p.category) ? p.category : 'a' })),
  });
}
module.exports = { visualPayload };
