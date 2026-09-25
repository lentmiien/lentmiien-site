const { parseItemCodes } = require('../../services/amiamiUploadParser');
const { MAX_HTML_BYTES, MAX_CODES } = require('../../utils/amiamiUploadPolicy');
const sample = '<li class="newly-added-items__item"><a href="/eng/detail?gcode=TOY-RBT-9417" alt="Figure"><div><img data-src="https://img.amiami.com/figure.jpg"></div><p>Figure</p></a></li>';

test.each(['\n', '\r\n', '\r'])('parses plain codes with line ending %j, trims whitespace/BOM, skips blanks and deduplicates', ending => {
  expect(parseItemCodes(['\ufeffTOY-RBT-9417', '', ' FIGURE-123\t', 'TOY-RBT-9417', 'goods-22', ''].join(ending), 'codes'))
    .toEqual(['TOY-RBT-9417', 'FIGURE-123', 'goods-22']);
});

test.each(['gcode', 'https://www.amiami.com/eng/detail?gcode=FIGURE-1', 'FIGURE-1,FIGURE-2',
  '<script>private</script>', '../../secret-1', 'FIGURE-1 FIGURE-2', '12345', `${'A'.repeat(79)}-1`])('rejects invalid text rows without echoing them: %s', row => {
  let error;
  try { parseItemCodes(`FIGURE-1\n\n${row}`, 'codes'); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ code: 'INVALID_CODE', status: 400 });
  expect(error.message).toContain('line 3');
  expect(error.message).not.toContain(row);
});

test('bounds text input and unique codes, and rejects empty/binary input and unknown formats', () => {
  for (const input of ['', ' \r\n\t', null]) expect(() => parseItemCodes(input, 'codes')).toThrow('no header');
  for (const input of ['FIGURE-1\0', 'FIGURE-1\ufffd']) expect(() => parseItemCodes(input, 'codes')).toThrow('UTF-8');
  expect(() => parseItemCodes('あ'.repeat(MAX_HTML_BYTES / 2), 'codes')).toThrow('2 MiB');
  const codes = Array.from({ length: MAX_CODES }, (_, i) => `FIGURE-${i}`).join('\n');
  expect(parseItemCodes(`${codes}\nFIGURE-0`, 'codes')).toHaveLength(MAX_CODES);
  expect(() => parseItemCodes(`${codes}\nFIGURE-${MAX_CODES}`, 'codes')).toThrow('1,000');
  expect(() => parseItemCodes('FIGURE-1', 'csv')).toThrow('input format');
});

test.each(['%s', '<div>%s</div>', '<body>%s</body>', '<!doctype html><html><body>%s</body></html>'])('extracts item codes at every copied level: %s', wrapper => {
  expect(parseItemCodes(wrapper.replace('%s', sample))).toEqual(['TOY-RBT-9417']);
});
test('tokenizes single quotes, attribute order/case, entities, absolute links and malformed fragments', () => {
  expect(parseItemCodes(`<DIV><A class='x' HREF='/eng/detail?lang=eng&amp;gcode=TOY-RBT-9417'>a</A>
    <a href=https://www.amiami.com/eng/detail?gcode=FIGURE-123>a</a>
    <a href='/eng/detail?gcode=TOY-RBT-9417'>duplicate</a><a href='/eng/detail?gcode=GOODS-22'>`))
    .toEqual(['TOY-RBT-9417', 'FIGURE-123', 'GOODS-22']);
});
test('never executes HTML or includes external, credentialed, script, comment or invalid links', () => {
  const html = sample + `
    <script>fetch('https://evil.invalid'); const x = '<a href="/eng/detail?gcode=BAD-1">';</script>
    <!-- <a href='/eng/detail?gcode=BAD-2'> -->
    <a href='//evil.invalid/eng/detail?gcode=BAD-3'>x</a>
    <a href='https://evil.invalid/eng/detail?gcode=BAD-4'>x</a>
    <a href='https://www.amiami.com@evil.invalid/eng/detail?gcode=BAD-5'>x</a>
    <a href='javascript:alert(1)'>x</a>
    <a href='/eng/detail?gcode=BAD-6&gcode=BAD-7'>x</a>
    <a href='/eng/detail?gcode=%3Cscript%3E'>x</a>
    <a href='/eng/detail?gcode=../../token'>x</a>
    <a href='/eng/detail?gcode=${'X'.repeat(90)}-1'>x</a>
    <a href='/eng/detail?gcode=12345'>x</a>`;
  expect(parseItemCodes(html)).toEqual(['TOY-RBT-9417']);
});
test.each(['', '<title>Just a moment...</title>', '<div>No item links</div>', '<img src="/eng/detail?gcode=FIGURE-1">'])('rejects inputs with no usable links', html => {
  expect(() => parseItemCodes(html)).toThrow();
});
test('rejects oversized bytes, binary/invalid UTF-8, and too many codes', () => {
  expect(() => parseItemCodes('あ'.repeat(MAX_HTML_BYTES / 2))).toThrow('2 MiB');
  expect(() => parseItemCodes(sample + '\0')).toThrow('UTF-8');
  expect(() => parseItemCodes(sample + '\ufffd')).toThrow('UTF-8');
  const links = Array.from({ length: MAX_CODES + 1 }, (_, i) => `<a href='/eng/detail?gcode=FIGURE-${i}'>x</a>`).join('');
  expect(() => parseItemCodes(links)).toThrow('1,000');
});
