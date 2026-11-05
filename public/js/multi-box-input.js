const fields = ['id', 'width', 'height', 'depth', 'quantity', 'weight', 'value', 'rotation', 'shrink', 'soft', 'fragile'];
// Quoted CSV, including escaped quotes, commas, CRLF, and embedded newlines.
export function parseItems(text) {
  if (text.length > 262144) throw new Error('CSV must be no larger than 256 KiB.');
  const rows = []; let row = []; let field = ''; let quoted = false; let closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i <= text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === undefined) throw new Error('Unclosed quoted CSV field.');
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r' || c === undefined) {
      row.push(field.trim()); field = ''; closed = false;
      if (c !== ',') {
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i += 1;
      }
    } else {
      if (closed || c === '"') throw new Error('Malformed quoted CSV field.');
      field += c;
    }
  }
  if (rows.length < 2) throw new Error('Enter a CSV header and at least one item.');
  const headers = rows.shift().map(value => value.toLowerCase());
  if (new Set(headers).size !== headers.length || headers.some(key => !fields.includes(key))
    || !fields.slice(0, 4).every(key => headers.includes(key))) throw new Error('Use unique headers including id,width,height,depth. Unknown columns are not allowed.');
  const ids = new Set(); let count = 0;
  const items = rows.map((values, index) => {
    const fail = message => { throw new Error(`Row ${index + 2}: ${message}`); };
    if (values.length !== headers.length) fail('column count does not match the header.');
    const item = {};
    headers.forEach((key, column) => {
      const value = values[column];
      if (!value && !fields.slice(0, 4).includes(key)) return;
      if (key === 'id') item.id = value;
      else if (key === 'rotation') {
        if (!['none', 'orthogonal', 'free'].includes(value.toLowerCase())) fail('rotation must be none, orthogonal or free.');
        item[key] = value.toLowerCase();
      } else if (key === 'soft' || key === 'fragile') {
        if (!/^(true|false|yes|no|1|0)$/i.test(value)) fail(`${key} must be true or false.`);
        item[key] = /^(true|yes|1)$/i.test(value);
      } else {
        const number = Number(value);
        if (!value || !Number.isFinite(number)) fail(`${key} must be a number.`);
        if (['width', 'height', 'depth'].includes(key) && (number < .01 || number > 100000)) fail('dimensions must be 0.01–100000 cm.');
        if (key === 'quantity' && (!Number.isInteger(number) || number < 1 || number > 500)) fail('quantity must be 1–500.');
        if (number < 0 || (key === 'shrink' && number > 95) || (key === 'value' && number > 2e9) || number > 1e12) fail(`${key} is out of range.`);
        item[key] = number;
      }
    });
    if (!item.id || item.id.length > 120 || ids.has(item.id)) fail('IDs must be unique and 1–120 characters.');
    ids.add(item.id); count += item.quantity ?? 1;
    return item;
  });
  if (count > 500) throw new Error('Use at most 500 items including quantities.');
  return items;
}
