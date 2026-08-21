const path = require('path');
const pug = require('pug');
const { diffCSV } = require('../../utils/diffCSV');

const commonLocals = {
  pageTitle: 'CSV Diff',
  loggedIn: false,
  permissions: [],
  htmlPaths: [],
  bookmarks: [],
  admin: false,
  errorMessage: '',
};

function render(overrides = {}) {
  return pug.renderFile(path.join(process.cwd(), 'views', 'csv_diff.pug'), {
    ...commonLocals,
    hasCompared: false,
    comparison: null,
    inputs: {
      a: '',
      b: '',
      aDelimiter: 'auto',
      bDelimiter: 'auto',
      aFilename: '',
      bFilename: '',
    },
    ...overrides,
  });
}

describe('CSV diff page', () => {
  test('renders paste, upload, and delimiter controls in the shared theme', () => {
    const html = render();

    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('href="/css/csv-diff.css"');
    expect(html).toContain('action="/csv-diff"');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('name="aFile"');
    expect(html).toContain('name="bFile"');
    expect(html).toContain('name="aDelimiter"');
    expect(html).toContain('Load deletion example');
    expect(html).toContain('src="/js/csv-diff.js"');
  });

  test('renders aligned cell findings and format diagnostics', () => {
    const left = 'id,value,unused,status\nA,1,drop,ready';
    const right = '"id"\t"value"\t"status"\r\n"A"\t"2"\t"ready"';
    const comparison = diffCSV(left, right);
    const html = render({
      hasCompared: true,
      comparison,
      inputs: {
        a: left,
        b: right,
        aDelimiter: 'auto',
        bDelimiter: 'auto',
        aFilename: '',
        bFilename: '',
      },
    });

    expect(html).toContain('Parsed cell content changed');
    expect(html).toContain('Cell removed; later cells in the row were realigned');
    expect(html).toContain('Field delimiter changed');
    expect(html).toContain('Cell quotation changed');
    expect(html).toContain('data-filter-kind="format"');
  });

  test('shows an exact-match result for identical inputs', () => {
    const source = 'a,b\n1,2';
    const html = render({
      hasCompared: true,
      comparison: diffCSV(source, source),
      inputs: {
        a: source,
        b: source,
        aDelimiter: 'auto',
        bDelimiter: 'auto',
        aFilename: '',
        bFilename: '',
      },
    });

    expect(html).toContain('No differences found');
    expect(html).toContain('byte-for-byte identical');
    expect(html).toContain('Exact source match');
  });
});
