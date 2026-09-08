const { visualPayload } = require('../../utils/accountLifeLogPayload');
const base = { canvas: { width: 400, height: 800 }, points: [{ x: .5, y: .5, radius: 8, opacity: 80, category: 'a' }] };
test('visual payload uses a fixed local image and bounded fields', () => {
  const result = JSON.parse(visualPayload(JSON.stringify({ ...base, image: 'https://evil.invalid/track', secret: 'omit' })));
  expect(result.image).toBe('/i/img_select.jpg'); expect(result.secret).toBeUndefined();
});
test.each([{ ...base, points: [] }, { ...base, points: Array(101).fill(base.points[0]) }, { ...base, points: [{ ...base.points[0], x: 2 }] }, { ...base, canvas: { width: -1, height: 4 } }])('rejects invalid visual data %#', input => {
  expect(() => visualPayload(JSON.stringify(input))).toThrow();
});
