const {
  CSVParseError,
  detectDelimiter,
  diffCSV,
  parseCSV,
} = require('../../utils/diffCSV');

describe('CSV parser and structure-aware diff', () => {
  test('reports no changes for identical input', () => {
    const source = 'id,name,comment\r\n1,"Alice","hello, world"\r\n';

    const result = diffCSV(source, source);

    expect(result.identical).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.summary).toEqual({
      total: 0,
      contentChanges: 0,
      changedCells: 0,
      addedCells: 0,
      removedCells: 0,
      addedRows: 0,
      removedRows: 0,
      formatChanges: 0,
    });
  });

  test('parses quoted delimiters, escaped quotes, and embedded newlines', () => {
    const parsed = parseCSV('"a,b",value\r\n"say ""hello""","two\nlines"\r\n');

    expect(parsed.format.delimiter).toBe(',');
    expect(parsed.format.lineEndingLabel).toBe('CRLF');
    expect(parsed.format.finalNewline).toBe(true);
    expect(parsed.rows.map((row) => row.cells.map((cell) => cell.value))).toEqual([
      ['a,b', 'value'],
      ['say "hello"', 'two\nlines'],
    ]);
  });

  test('detects delimiter, line-ending, and quotation-only changes', () => {
    const left = 'name,score\nAlice,1\n';
    const right = '"name"\t"score"\r\n"Alice"\t"1"\r\n';

    const result = diffCSV(left, right);

    expect(result.summary.contentChanges).toBe(0);
    expect(result.summary.formatChanges).toBe(6);
    expect(result.entries.filter((entry) => entry.property === 'cellRepresentation')).toHaveLength(4);
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'format', scope: 'file', property: 'delimiter' }),
      expect.objectContaining({ kind: 'format', scope: 'file', property: 'lineEnding' }),
      expect.objectContaining({
        kind: 'format',
        scope: 'cell',
        location: 'R1A',
        aDisplay: 'name',
        bDisplay: '"name"',
      }),
    ]));
  });

  test('realigns cells after a changed number and a removed block', () => {
    const left = [
      'record,version,item1,item2,item3,status',
      'A,1,red,green,blue,ready',
    ].join('\n');
    const right = [
      'record,version,status',
      'A,2,ready',
    ].join('\n');

    const result = diffCSV(left, right);

    expect(result.summary).toEqual(expect.objectContaining({
      changedCells: 1,
      removedCells: 6,
      addedCells: 0,
      addedRows: 0,
      removedRows: 0,
      formatChanges: 0,
    }));
    expect(result.groups.changed).toEqual([
      expect.objectContaining({ location: 'R2B', aDisplay: '1', bDisplay: '2' }),
    ]);
    expect(result.groups.removed.map((entry) => entry.aDisplay)).toEqual([
      'item1',
      'item2',
      'item3',
      'red',
      'green',
      'blue',
    ]);
    expect(result.entries.some((entry) => entry.aDisplay === 'ready')).toBe(false);
  });

  test('reports a removed row once and realigns the rows below it', () => {
    const left = 'id,name\n1,Alice\n2,Bob\n3,Carol';
    const right = 'id,name\n1,Alice\n3,Carol';

    const result = diffCSV(left, right);

    expect(result.summary).toEqual(expect.objectContaining({
      changedCells: 0,
      removedCells: 0,
      removedRows: 1,
      contentChanges: 1,
    }));
    expect(result.groups.removed).toEqual([
      expect.objectContaining({
        scope: 'row',
        location: 'Left row 3',
        aDisplay: '["2", "Bob"]',
      }),
    ]);
  });

  test('reports inserted cells without changing the cells after them', () => {
    const result = diffCSV('a,b,e', 'a,b,c,d,e');

    expect(result.summary).toEqual(expect.objectContaining({
      changedCells: 0,
      addedCells: 2,
      removedCells: 0,
      addedRows: 0,
    }));
    expect(result.groups.added.map((entry) => entry.bDisplay)).toEqual(['c', 'd']);
    expect(result.entries.some((entry) => entry.aDisplay === 'e')).toBe(false);
  });

  test('does not infer a delimiter change when removals leave one column', () => {
    const result = diffCSV('1,a,b,c', '2');

    expect(result.summary).toEqual(expect.objectContaining({
      changedCells: 1,
      removedCells: 3,
      formatChanges: 0,
    }));
  });

  test('reports BOM and final-newline changes as formatting', () => {
    const bomResult = diffCSV('\uFEFFa,b\n', 'a,b\n');
    const newlineResult = diffCSV('a,b', 'a,b\n');

    expect(bomResult.summary.formatChanges).toBe(1);
    expect(bomResult.entries[0]).toEqual(expect.objectContaining({ property: 'byteOrderMark' }));
    expect(newlineResult.summary.formatChanges).toBe(1);
    expect(newlineResult.entries[0]).toEqual(expect.objectContaining({ property: 'finalNewline' }));
  });

  test('supports explicit delimiter selection for ambiguous input', () => {
    const parsed = parseCSV('one|two|three', { delimiter: 'pipe' });

    expect(parsed.rows[0].cells.map((cell) => cell.value)).toEqual(['one', 'two', 'three']);
    expect(parsed.format.delimiterLabel).toBe('Pipe (|)');
    expect(detectDelimiter('a;b\n1;2')).toBe(';');
  });

  test('identifies which side contains malformed quoted CSV', () => {
    expect(() => diffCSV('a,b\n1,2', 'a,b\n1,"two')).toThrow(CSVParseError);

    try {
      diffCSV('a,b\n1,2', 'a,b\n1,"two');
    } catch (error) {
      expect(error.side).toBe('right');
      expect(error.message).toContain('Unclosed quoted field');
      expect(error.message).toContain('row 2, column 2');
    }
  });

  test('stops pathologically wide inputs at the parser guardrail', () => {
    expect(() => parseCSV('a,b', { maxCells: 1 })).toThrow('more than 1 cells');
  });
});
