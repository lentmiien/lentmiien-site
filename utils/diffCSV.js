'use strict';

const DELIMITERS = {
  comma: ',',
  tab: '\t',
  semicolon: ';',
  pipe: '|',
};

const DELIMITER_CANDIDATES = [',', '\t', ';', '|'];
const DEFAULT_MAX_MATRIX_CELLS = 2_000_000;
const DEFAULT_MAX_PARSED_CELLS = 250_000;
const DEFAULT_MAX_PARSED_ROWS = 100_000;

class CSVParseError extends Error {
  constructor(message, row, column) {
    const position = Number.isInteger(row) && Number.isInteger(column)
      ? ` (row ${row}, column ${column})`
      : '';
    super(`${message}${position}`);
    this.name = 'CSVParseError';
    this.row = row;
    this.column = column;
  }
}

function normalizeDelimiterOption(value) {
  if (value === undefined || value === null || value === '' || value === 'auto') {
    return 'auto';
  }

  if (Object.prototype.hasOwnProperty.call(DELIMITERS, value)) {
    return value;
  }

  const matchingName = Object.keys(DELIMITERS).find((name) => DELIMITERS[name] === value);
  if (matchingName) {
    return matchingName;
  }

  throw new CSVParseError('Unsupported delimiter selection');
}

function scanDelimiterCounts(source, delimiter) {
  const counts = [];
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      count += 1;
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      counts.push(count);
      count = 0;
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      if (counts.length >= 100) {
        return counts;
      }
    }
  }

  if (counts.length < 100 && (source.length > 0 || count > 0)) {
    counts.push(count);
  }

  return counts;
}

function scoreDelimiter(source, delimiter, candidateIndex) {
  const counts = scanDelimiterCounts(source, delimiter);
  if (counts.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const frequencies = new Map();
  counts.forEach((count) => {
    frequencies.set(count, (frequencies.get(count) || 0) + 1);
  });

  let modeCount = 0;
  let modeFrequency = 0;
  frequencies.forEach((frequency, count) => {
    if (count > 0 && (frequency > modeFrequency || (frequency === modeFrequency && count > modeCount))) {
      modeCount = count;
      modeFrequency = frequency;
    }
  });

  if (modeCount === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const positiveRows = counts.filter((count) => count > 0).length;
  const coverage = positiveRows / counts.length;
  const consistency = modeFrequency / counts.length;
  const preference = (DELIMITER_CANDIDATES.length - candidateIndex) / 1000;

  return (coverage * 1000) + (consistency * 100) + Math.min(modeCount, 20) + preference;
}

function detectDelimiter(source) {
  let bestDelimiter = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  DELIMITER_CANDIDATES.forEach((delimiter, index) => {
    const score = scoreDelimiter(source, delimiter, index);
    if (score > bestScore) {
      bestDelimiter = delimiter;
      bestScore = score;
    }
  });

  return bestDelimiter;
}

function delimiterName(delimiter) {
  const names = {
    ',': 'Comma (,)',
    '\t': 'Tab (\\t)',
    ';': 'Semicolon (;)',
    '|': 'Pipe (|)',
  };
  return names[delimiter] || 'None detected (single column)';
}

function lineEndingName(lineEndings) {
  const present = Object.entries(lineEndings).filter(([, count]) => count > 0);
  if (present.length === 0) {
    return 'None';
  }
  if (present.length === 1) {
    return present[0][0];
  }
  return `Mixed (${present.map(([name, count]) => `${name}: ${count}`).join(', ')})`;
}

function parseCSV(input, userOptions = {}) {
  const source = typeof input === 'string' ? input : String(input ?? '');
  const hasBom = source.startsWith('\uFEFF');
  const text = hasBom ? source.slice(1) : source;
  const delimiterOption = normalizeDelimiterOption(userOptions.delimiter);
  const detectedDelimiter = detectDelimiter(text);
  const delimiter = delimiterOption === 'auto'
    ? detectedDelimiter
    : DELIMITERS[delimiterOption];
  const parseDelimiter = delimiter || ',';

  const rows = [];
  const lineEndings = { LF: 0, CRLF: 0, CR: 0 };
  let cells = [];
  let value = '';
  let raw = '';
  let quoted = false;
  let inQuotes = false;
  let quoteClosed = false;
  let trailingWhitespace = '';
  let lastTokenWasRowTerminator = false;
  let parsedCellCount = 0;

  const finishField = () => {
    parsedCellCount += 1;
    if (parsedCellCount > (userOptions.maxCells || DEFAULT_MAX_PARSED_CELLS)) {
      throw new CSVParseError(
        `CSV contains more than ${userOptions.maxCells || DEFAULT_MAX_PARSED_CELLS} cells`,
        rows.length + 1,
        cells.length + 1
      );
    }
    cells.push({
      value,
      raw,
      quoted,
      trailingWhitespace,
      rowIndex: rows.length,
      columnIndex: cells.length,
    });
    value = '';
    raw = '';
    quoted = false;
    inQuotes = false;
    quoteClosed = false;
    trailingWhitespace = '';
  };

  const finishRow = (terminator = '') => {
    if (rows.length >= (userOptions.maxRows || DEFAULT_MAX_PARSED_ROWS)) {
      throw new CSVParseError(
        `CSV contains more than ${userOptions.maxRows || DEFAULT_MAX_PARSED_ROWS} rows`,
        rows.length + 1,
        cells.length + 1
      );
    }
    finishField();
    rows.push({
      index: rows.length,
      cells,
      terminator,
    });
    cells = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      raw += char;
      if (char === '"') {
        if (text[index + 1] === '"') {
          raw += '"';
          value += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        value += char;
      }
      lastTokenWasRowTerminator = false;
      continue;
    }

    if (char === parseDelimiter) {
      finishField();
      lastTokenWasRowTerminator = false;
      continue;
    }

    if (char === '\n' || char === '\r') {
      let terminator = char;
      let lineEnding = char === '\n' ? 'LF' : 'CR';
      if (char === '\r' && text[index + 1] === '\n') {
        terminator = '\r\n';
        lineEnding = 'CRLF';
        index += 1;
      }
      lineEndings[lineEnding] += 1;
      finishRow(terminator);
      lastTokenWasRowTerminator = true;
      continue;
    }

    if (quoteClosed) {
      if (char === ' ' || char === '\t') {
        raw += char;
        trailingWhitespace += char;
        lastTokenWasRowTerminator = false;
        continue;
      }
      throw new CSVParseError(
        `Unexpected ${JSON.stringify(char)} after a closing quotation mark`,
        rows.length + 1,
        cells.length + 1
      );
    }

    if (char === '"' && raw.length === 0) {
      quoted = true;
      inQuotes = true;
      raw += char;
      lastTokenWasRowTerminator = false;
      continue;
    }

    raw += char;
    value += char;
    lastTokenWasRowTerminator = false;
  }

  if (inQuotes) {
    throw new CSVParseError(
      'Unclosed quoted field',
      rows.length + 1,
      cells.length + 1
    );
  }

  if (text.length > 0 && !lastTokenWasRowTerminator) {
    finishRow('');
  }

  const quotedCellCount = rows.reduce(
    (total, row) => total + row.cells.filter((cell) => cell.quoted).length,
    0
  );
  const maxColumns = rows.reduce((maximum, row) => Math.max(maximum, row.cells.length), 0);
  const lineEndingLabel = lineEndingName(lineEndings);

  return {
    source,
    rows,
    format: {
      delimiter,
      delimiterLabel: delimiterName(delimiter),
      delimiterMode: delimiterOption,
      detectedDelimiter,
      lineEndings,
      lineEndingLabel,
      lineEndingCount: Object.values(lineEndings).reduce((total, count) => total + count, 0),
      hasBom,
      finalNewline: text.length > 0 && lastTokenWasRowTerminator,
      quotedCellCount,
    },
    rowCount: rows.length,
    maxColumns,
  };
}

function longestIncreasingSubsequence(items) {
  if (items.length === 0) {
    return [];
  }

  const tails = [];
  const previous = new Array(items.length).fill(-1);

  items.forEach((item, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (items[tails[middle]].bIndex < item.bIndex) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    if (low > 0) {
      previous[index] = tails[low - 1];
    }
    tails[low] = index;
  });

  const sequence = [];
  let cursor = tails[tails.length - 1];
  while (cursor >= 0) {
    sequence.push(items[cursor]);
    cursor = previous[cursor];
  }
  return sequence.reverse();
}

function findUniqueAnchors(a, b, aStart, aEnd, bStart, bEnd, key, equals) {
  const aKeys = new Map();
  const bKeys = new Map();

  for (let index = aStart; index < aEnd; index += 1) {
    const itemKey = key(a[index]);
    const current = aKeys.get(itemKey);
    aKeys.set(itemKey, current ? { count: current.count + 1, index } : { count: 1, index });
  }
  for (let index = bStart; index < bEnd; index += 1) {
    const itemKey = key(b[index]);
    const current = bKeys.get(itemKey);
    bKeys.set(itemKey, current ? { count: current.count + 1, index } : { count: 1, index });
  }

  const candidates = [];
  aKeys.forEach((aEntry, itemKey) => {
    const bEntry = bKeys.get(itemKey);
    if (aEntry.count === 1 && bEntry?.count === 1 && equals(a[aEntry.index], b[bEntry.index])) {
      candidates.push({ aIndex: aEntry.index, bIndex: bEntry.index });
    }
  });
  candidates.sort((left, right) => left.aIndex - right.aIndex);
  return longestIncreasingSubsequence(candidates);
}

function alignMatrix(a, b, aStart, aEnd, bStart, bEnd, options) {
  const aLength = aEnd - aStart;
  const bLength = bEnd - bStart;
  const width = bLength + 1;
  const directions = new Uint8Array((aLength + 1) * width);
  let previous = new Float64Array(width);
  let current = new Float64Array(width);

  for (let column = 1; column <= bLength; column += 1) {
    previous[column] = column;
    directions[column] = 3;
  }

  for (let row = 1; row <= aLength; row += 1) {
    current[0] = row;
    directions[row * width] = 2;

    for (let column = 1; column <= bLength; column += 1) {
      const aItem = a[aStart + row - 1];
      const bItem = b[bStart + column - 1];
      const equal = options.equals(aItem, bItem);
      const diagonal = previous[column - 1] + (equal ? 0 : options.substitutionCost(aItem, bItem));
      const deletion = previous[column] + 1;
      const insertion = current[column - 1] + 1;
      const minimum = Math.min(diagonal, deletion, insertion);
      const epsilon = 1e-9;
      let direction;

      if (equal && Math.abs(diagonal - minimum) <= epsilon) {
        direction = 1;
      } else if (row > column && Math.abs(deletion - minimum) <= epsilon) {
        direction = 2;
      } else if (column > row && Math.abs(insertion - minimum) <= epsilon) {
        direction = 3;
      } else if (Math.abs(diagonal - minimum) <= epsilon) {
        direction = 1;
      } else if (Math.abs(deletion - minimum) <= epsilon) {
        direction = 2;
      } else {
        direction = 3;
      }

      current[column] = direction === 1 ? diagonal : (direction === 2 ? deletion : insertion);
      directions[(row * width) + column] = direction;
    }

    const swap = previous;
    previous = current;
    current = swap;
  }

  const operations = [];
  let row = aLength;
  let column = bLength;
  while (row > 0 || column > 0) {
    const direction = directions[(row * width) + column];
    if (direction === 1) {
      const aIndex = aStart + row - 1;
      const bIndex = bStart + column - 1;
      operations.push({
        type: options.equals(a[aIndex], b[bIndex]) ? 'equal' : 'aligned',
        aIndex,
        bIndex,
      });
      row -= 1;
      column -= 1;
    } else if (direction === 2) {
      operations.push({ type: 'removed', aIndex: aStart + row - 1, bIndex: null });
      row -= 1;
    } else {
      operations.push({ type: 'added', aIndex: null, bIndex: bStart + column - 1 });
      column -= 1;
    }
  }

  return operations.reverse();
}

function alignSequences(a, b, userOptions = {}) {
  const options = {
    equals: (left, right) => left === right,
    substitutionCost: () => 1,
    key: (item) => JSON.stringify(item),
    maxMatrixCells: DEFAULT_MAX_MATRIX_CELLS,
    ...userOptions,
  };

  function alignRange(aStart, aEnd, bStart, bEnd) {
    const prefix = [];
    const suffix = [];

    while (aStart < aEnd && bStart < bEnd && options.equals(a[aStart], b[bStart])) {
      prefix.push({ type: 'equal', aIndex: aStart, bIndex: bStart });
      aStart += 1;
      bStart += 1;
    }

    while (aStart < aEnd && bStart < bEnd && options.equals(a[aEnd - 1], b[bEnd - 1])) {
      aEnd -= 1;
      bEnd -= 1;
      suffix.push({ type: 'equal', aIndex: aEnd, bIndex: bEnd });
    }

    let middle = [];
    const aLength = aEnd - aStart;
    const bLength = bEnd - bStart;

    if (aLength === 0) {
      for (let index = bStart; index < bEnd; index += 1) {
        middle.push({ type: 'added', aIndex: null, bIndex: index });
      }
    } else if (bLength === 0) {
      for (let index = aStart; index < aEnd; index += 1) {
        middle.push({ type: 'removed', aIndex: index, bIndex: null });
      }
    } else if ((aLength + 1) * (bLength + 1) <= options.maxMatrixCells) {
      middle = alignMatrix(a, b, aStart, aEnd, bStart, bEnd, options);
    } else {
      const anchors = findUniqueAnchors(
        a,
        b,
        aStart,
        aEnd,
        bStart,
        bEnd,
        options.key,
        options.equals
      );

      if (anchors.length > 0) {
        let nextA = aStart;
        let nextB = bStart;
        anchors.forEach((anchor) => {
          middle.push(...alignRange(nextA, anchor.aIndex, nextB, anchor.bIndex));
          middle.push({ type: 'equal', aIndex: anchor.aIndex, bIndex: anchor.bIndex });
          nextA = anchor.aIndex + 1;
          nextB = anchor.bIndex + 1;
        });
        middle.push(...alignRange(nextA, aEnd, nextB, bEnd));
      } else {
        const paired = Math.min(aLength, bLength);
        for (let offset = 0; offset < paired; offset += 1) {
          middle.push({
            type: options.equals(a[aStart + offset], b[bStart + offset]) ? 'equal' : 'aligned',
            aIndex: aStart + offset,
            bIndex: bStart + offset,
          });
        }
        for (let index = aStart + paired; index < aEnd; index += 1) {
          middle.push({ type: 'removed', aIndex: index, bIndex: null });
        }
        for (let index = bStart + paired; index < bEnd; index += 1) {
          middle.push({ type: 'added', aIndex: null, bIndex: index });
        }
      }
    }

    return prefix.concat(middle, suffix.reverse());
  }

  return alignRange(0, a.length, 0, b.length);
}

function rowValues(row) {
  return row.cells.map((cell) => cell.value);
}

function rowsEqual(left, right) {
  if (left.cells.length !== right.cells.length) {
    return false;
  }
  return left.cells.every((cell, index) => cell.value === right.cells[index].value);
}

function rowKey(row) {
  return JSON.stringify(rowValues(row));
}

function rowSubstitutionCost(left, right) {
  const leftValues = rowValues(left);
  const rightValues = rowValues(right);
  const maximumLength = Math.max(leftValues.length, rightValues.length);
  if (maximumLength === 0) {
    return 0;
  }

  const counts = new Map();
  leftValues.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  let overlap = 0;
  rightValues.forEach((value) => {
    const count = counts.get(value) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(value, count - 1);
    }
  });

  const similarity = overlap / maximumLength;
  return 0.5 + (1 - similarity);
}

function columnLabel(index) {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function cellPosition(rowIndex, columnIndex) {
  return {
    row: rowIndex + 1,
    column: columnIndex + 1,
    columnLabel: columnLabel(columnIndex),
  };
}

function positionText(position) {
  return `R${position.row}${position.columnLabel}`;
}

function locationText(aPosition, bPosition, scope) {
  if (scope === 'file') {
    return 'File format';
  }
  if (scope === 'row') {
    if (aPosition && bPosition && aPosition.row === bPosition.row) {
      return `Row ${aPosition.row}`;
    }
    if (aPosition && bPosition) {
      return `Left row ${aPosition.row} → right row ${bPosition.row}`;
    }
    return aPosition ? `Left row ${aPosition.row}` : `Right row ${bPosition.row}`;
  }
  if (aPosition && bPosition && aPosition.row === bPosition.row && aPosition.column === bPosition.column) {
    return positionText(aPosition);
  }
  if (aPosition && bPosition) {
    return `Left ${positionText(aPosition)} → right ${positionText(bPosition)}`;
  }
  return aPosition ? `Left ${positionText(aPosition)}` : `Right ${positionText(bPosition)}`;
}

function displayCellValue(value) {
  return JSON.stringify(value);
}

function displayRawCell(raw) {
  if (raw === '') {
    return '(empty field)';
  }
  return raw
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function displayRow(row) {
  const rendered = `[${row.cells.map((cell) => displayCellValue(cell.value)).join(', ')}]`;
  return rendered.length > 600 ? `${rendered.slice(0, 597)}…` : rendered;
}

function publicSide(parsed) {
  return {
    rowCount: parsed.rowCount,
    maxColumns: parsed.maxColumns,
    format: {
      ...parsed.format,
      lineEndings: { ...parsed.format.lineEndings },
    },
  };
}

function diffCSV(leftInput, rightInput, userOptions = {}) {
  const leftSource = typeof leftInput === 'string' ? leftInput : String(leftInput ?? '');
  const rightSource = typeof rightInput === 'string' ? rightInput : String(rightInput ?? '');
  const leftDelimiterOption = normalizeDelimiterOption(userOptions.leftDelimiter);
  const rightDelimiterOption = normalizeDelimiterOption(userOptions.rightDelimiter);
  const parserLimits = {
    maxCells: userOptions.maxCells,
    maxRows: userOptions.maxRows,
  };
  let left;
  let right;
  try {
    left = parseCSV(leftSource, { ...parserLimits, delimiter: leftDelimiterOption });
  } catch (error) {
    if (error instanceof CSVParseError) {
      error.side = 'left';
    }
    throw error;
  }
  if (leftSource === rightSource && leftDelimiterOption === rightDelimiterOption) {
    right = left;
  } else {
    try {
      right = parseCSV(rightSource, { ...parserLimits, delimiter: rightDelimiterOption });
    } catch (error) {
      if (error instanceof CSVParseError) {
        error.side = 'right';
      }
      throw error;
    }
  }
  const entries = [];
  let nextId = 1;

  const addEntry = ({ kind, scope, property = null, aPosition = null, bPosition = null, aDisplay, bDisplay, detail }) => {
    entries.push({
      id: nextId,
      kind,
      scope,
      property,
      aPosition,
      bPosition,
      location: locationText(aPosition, bPosition, scope),
      aDisplay,
      bDisplay,
      detail,
    });
    nextId += 1;
  };

  const leftDelimiterObservable = left.format.delimiterMode !== 'auto'
    || left.format.detectedDelimiter !== null;
  const rightDelimiterObservable = right.format.delimiterMode !== 'auto'
    || right.format.detectedDelimiter !== null;

  if (
    leftDelimiterObservable
    && rightDelimiterObservable
    && left.format.delimiter !== right.format.delimiter
  ) {
    addEntry({
      kind: 'format',
      scope: 'file',
      property: 'delimiter',
      aDisplay: left.format.delimiterLabel,
      bDisplay: right.format.delimiterLabel,
      detail: 'Field delimiter changed',
    });
  }

  if (
    left.format.lineEndingCount > 0
    && right.format.lineEndingCount > 0
    && left.format.lineEndingLabel !== right.format.lineEndingLabel
  ) {
    addEntry({
      kind: 'format',
      scope: 'file',
      property: 'lineEnding',
      aDisplay: left.format.lineEndingLabel,
      bDisplay: right.format.lineEndingLabel,
      detail: 'Record line endings changed',
    });
  }

  if (left.format.hasBom !== right.format.hasBom) {
    addEntry({
      kind: 'format',
      scope: 'file',
      property: 'byteOrderMark',
      aDisplay: left.format.hasBom ? 'UTF-8 BOM present' : 'No BOM',
      bDisplay: right.format.hasBom ? 'UTF-8 BOM present' : 'No BOM',
      detail: 'UTF-8 byte-order mark changed',
    });
  }

  if (left.format.finalNewline !== right.format.finalNewline) {
    addEntry({
      kind: 'format',
      scope: 'file',
      property: 'finalNewline',
      aDisplay: left.format.finalNewline ? 'Present' : 'Missing',
      bDisplay: right.format.finalNewline ? 'Present' : 'Missing',
      detail: 'Final record terminator changed',
    });
  }

  const rowOperations = alignSequences(left.rows, right.rows, {
    equals: rowsEqual,
    substitutionCost: rowSubstitutionCost,
    key: rowKey,
    maxMatrixCells: userOptions.maxMatrixCells || DEFAULT_MAX_MATRIX_CELLS,
  });

  rowOperations.forEach((rowOperation) => {
    if (rowOperation.type === 'removed') {
      const row = left.rows[rowOperation.aIndex];
      const aPosition = { row: row.index + 1 };
      addEntry({
        kind: 'removed',
        scope: 'row',
        aPosition,
        aDisplay: displayRow(row),
        bDisplay: '(missing row)',
        detail: 'Row removed; later rows were realigned',
      });
      return;
    }

    if (rowOperation.type === 'added') {
      const row = right.rows[rowOperation.bIndex];
      const bPosition = { row: row.index + 1 };
      addEntry({
        kind: 'added',
        scope: 'row',
        bPosition,
        aDisplay: '(missing row)',
        bDisplay: displayRow(row),
        detail: 'Row added; later rows were realigned',
      });
      return;
    }

    const leftRow = left.rows[rowOperation.aIndex];
    const rightRow = right.rows[rowOperation.bIndex];
    const cellOperations = alignSequences(leftRow.cells, rightRow.cells, {
      equals: (leftCell, rightCell) => leftCell.value === rightCell.value,
      substitutionCost: () => 1,
      key: (cell) => cell.value,
      maxMatrixCells: userOptions.maxMatrixCells || DEFAULT_MAX_MATRIX_CELLS,
    });

    cellOperations.forEach((cellOperation) => {
      if (cellOperation.type === 'removed') {
        const cell = leftRow.cells[cellOperation.aIndex];
        const aPosition = cellPosition(leftRow.index, cell.columnIndex);
        addEntry({
          kind: 'removed',
          scope: 'cell',
          aPosition,
          aDisplay: displayRawCell(cell.raw),
          bDisplay: '(missing cell)',
          detail: 'Cell removed; later cells in the row were realigned',
        });
        return;
      }

      if (cellOperation.type === 'added') {
        const cell = rightRow.cells[cellOperation.bIndex];
        const bPosition = cellPosition(rightRow.index, cell.columnIndex);
        addEntry({
          kind: 'added',
          scope: 'cell',
          bPosition,
          aDisplay: '(missing cell)',
          bDisplay: displayRawCell(cell.raw),
          detail: 'Cell added; later cells in the row were realigned',
        });
        return;
      }

      const leftCell = leftRow.cells[cellOperation.aIndex];
      const rightCell = rightRow.cells[cellOperation.bIndex];
      const aPosition = cellPosition(leftRow.index, leftCell.columnIndex);
      const bPosition = cellPosition(rightRow.index, rightCell.columnIndex);

      if (leftCell.value !== rightCell.value) {
        addEntry({
          kind: 'changed',
          scope: 'cell',
          aPosition,
          bPosition,
          aDisplay: displayRawCell(leftCell.raw),
          bDisplay: displayRawCell(rightCell.raw),
          detail: 'Parsed cell content changed',
        });
      }

      const representationChanged = leftCell.quoted !== rightCell.quoted
        || leftCell.trailingWhitespace !== rightCell.trailingWhitespace
        || (leftCell.value === rightCell.value && leftCell.raw !== rightCell.raw);

      if (representationChanged) {
        let detail = 'Cell representation changed without changing its parsed value';
        if (leftCell.quoted !== rightCell.quoted) {
          detail = 'Cell quotation changed';
        } else if (leftCell.trailingWhitespace !== rightCell.trailingWhitespace) {
          detail = 'Whitespace after the closing quotation mark changed';
        }
        addEntry({
          kind: 'format',
          scope: 'cell',
          property: 'cellRepresentation',
          aPosition,
          bPosition,
          aDisplay: displayRawCell(leftCell.raw),
          bDisplay: displayRawCell(rightCell.raw),
          detail,
        });
      }
    });
  });

  if (leftSource !== rightSource && entries.length === 0) {
    addEntry({
      kind: 'format',
      scope: 'file',
      property: 'rawRepresentation',
      aDisplay: 'Raw source differs',
      bDisplay: 'Raw source differs',
      detail: 'The raw file representation changed without changing parsed cells',
    });
  }

  const groups = { changed: [], added: [], removed: [], format: [] };
  const summary = {
    total: 0,
    contentChanges: 0,
    changedCells: 0,
    addedCells: 0,
    removedCells: 0,
    addedRows: 0,
    removedRows: 0,
    formatChanges: 0,
  };

  entries.forEach((entry) => {
    groups[entry.kind].push(entry);
    if (entry.kind === 'format') {
      summary.formatChanges += 1;
    } else if (entry.scope === 'row' && entry.kind === 'added') {
      summary.addedRows += 1;
      summary.contentChanges += 1;
    } else if (entry.scope === 'row' && entry.kind === 'removed') {
      summary.removedRows += 1;
      summary.contentChanges += 1;
    } else if (entry.kind === 'added') {
      summary.addedCells += 1;
      summary.contentChanges += 1;
    } else if (entry.kind === 'removed') {
      summary.removedCells += 1;
      summary.contentChanges += 1;
    } else if (entry.kind === 'changed') {
      summary.changedCells += 1;
      summary.contentChanges += 1;
    }
  });
  summary.total = entries.length;

  return {
    identical: leftSource === rightSource,
    entries,
    groups,
    summary,
    left: publicSide(left),
    right: publicSide(right),
    optionsUsed: {
      leftDelimiter: leftDelimiterOption,
      rightDelimiter: rightDelimiterOption,
    },
  };
}

module.exports = {
  CSVParseError,
  DELIMITERS,
  alignSequences,
  detectDelimiter,
  diffCSV,
  parseCSV,
};
