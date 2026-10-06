const { parseCsv, MAX_BYTES, registryCandidate } = require('../../services/taric/approvedCodes');
const { hash } = require('../../utils/taricProtocol');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
test('imports the existing taricCode-only CSV without losing leading zeroes; merges repeats', async () => {
  const parsed = await parseCsv(Buffer.from('\ufefftaricCode\r\n0012345678\r\n0012.34.56.78\r\n9503009590\r\n'));
  expect(parsed).toMatchObject({ count: 3, duplicates: 1, rows: [
    { _id: '0012345678', headings: '', goods_summary: '', description_summary: '' },
    { _id: '9503009590', headings: '', goods_summary: '', description_summary: '' },
  ] });
});
test('quoted multiline headings and non-conflicting repeated descriptions merge', async () => {
  const parsed = await parseCsv(Buffer.from('taric_code,headings,goods_summary,description_summary\n0012345678,"Heading, one\nHeading two",,Stable\n0012345678,,Goods,Stable\n'));
  expect(parsed.rows[0]).toMatchObject({ headings: 'Heading, one\nHeading two', goods_summary: 'Goods', description_summary: 'Stable' });
});
test.each([
  'taricCode\n12345678', 'taricCode\n9.503E+09', 'taricCode\n=9503009590', 'taricCode\n',
  'taricCode,taric_code\n0012345678,0012345678', 'taricCode,owner\n0012345678,other',
  'taricCode,description_summary\n0012345678,First\n0012345678,Second',
  'taricCode,description_summary\n0012345678,' + 'x'.repeat(256),
  'taricCode\n0012345678,extra', 'taricCode\n"0012345678',
])('rejects malformed/ambiguous CSV before writes: %s', async csv => {
  await expect(parseCsv(Buffer.from(csv))).rejects.toMatchObject({ code: 'IMPORT_INVALID' });
});
test('bounds bytes, row count and UTF-8 decoding', async () => {
  for (const input of [Buffer.alloc(MAX_BYTES + 1), Buffer.from([0xff]), Buffer.from('taricCode\n' + '0012345678\n'.repeat(10001))]) {
    await expect(parseCsv(input)).rejects.toMatchObject({ code: 'IMPORT_INVALID' });
  }
});
test('registry descriptions retain the original review and bind the frozen registry snapshot', () => {
  const review = { approvedDescription: 'Old per-product wording' };
  const entry = { taric_code: '0012345678', approved: true, revision: 2, headings: 'Heading', goods_summary: 'Goods', description_summary: 'Stable' };
  const candidate = registryCandidate({ review, approvedDescription: review.approvedDescription, missingness: { approvedDescription: true } }, entry);
  expect(candidate.review).toBe(review);
  expect(candidate).toMatchObject({ approvedDescription: 'Stable', approvedCodeHash: hash(entry), missingness: { approvedDescription: false } });
});
