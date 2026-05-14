const { parseString } = require('fast-csv');

const MAX_SAMPLE_VALUES = 3;

const normalizeHeader = (value) => String(value || '')
  .replace(/^\uFEFF/, '')
  .trim()
  .toLowerCase();

const normalizeLabelKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const toSnakeCase = (value) => String(value || '')
  .trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^a-zA-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();

const stripBom = (value) => String(value || '').replace(/^\uFEFF/, '');

const pad2 = (value) => String(value).padStart(2, '0');

const formatDateLocal = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const INS_MART_COLUMNS = {
  Weight: {
    defaultLabel: 'weight_kg',
    labelCandidates: ['weight_kg', 'weight'],
    parser: 'number',
  },
  BMI: {
    defaultLabel: 'bmi',
    labelCandidates: ['bmi'],
    parser: 'number',
  },
  'Body fat': {
    defaultLabel: 'body_fat_percent',
    labelCandidates: ['body_fat_percent', 'body_fat'],
    parser: 'number',
  },
  'Muscle mass': {
    defaultLabel: 'muscle_mass_kg',
    labelCandidates: ['muscle_mass_kg', 'muscle_mass'],
    parser: 'number',
  },
  'Body water': {
    defaultLabel: 'body_water_percent',
    labelCandidates: ['body_water_percent', 'body_water'],
    parser: 'number',
  },
  'Visceral fat': {
    defaultLabel: 'visceral_fat',
    labelCandidates: ['visceral_fat'],
    parser: 'number',
  },
  'Bone mass': {
    defaultLabel: 'bone_mass_kg',
    labelCandidates: ['bone_mass_kg', 'bone_mass'],
    parser: 'number',
  },
  BMR: {
    defaultLabel: 'bmr',
    labelCandidates: ['bmr'],
    parser: 'number',
  },
  Protein: {
    defaultLabel: 'protein_percent',
    labelCandidates: ['protein_percent', 'protein'],
    parser: 'number',
  },
  'Fat level': {
    defaultLabel: 'fat_level',
    labelCandidates: ['fat_level'],
    parser: 'number',
  },
  'Subcutaneous fat': {
    defaultLabel: 'subcutaneous_fat_percent',
    labelCandidates: ['subcutaneous_fat_percent', 'subcutaneous_fat'],
    parser: 'number',
  },
  'Lean body mass': {
    defaultLabel: 'lean_body_mass_kg',
    labelCandidates: ['lean_body_mass_kg', 'lean_body_mass'],
    parser: 'number',
  },
  'Body Type': {
    defaultLabel: '',
    defaultEnabled: false,
    parser: 'text',
    ignoreReason: 'Text column',
  },
  'Standard Weight': {
    defaultLabel: 'standard_weight_kg',
    labelCandidates: ['standard_weight_kg', 'standard_weight'],
    parser: 'number',
  },
  'Heart Rate': {
    defaultLabel: '',
    defaultEnabled: false,
    parser: 'number',
    ignoreReason: 'Ignored by default',
  },
  'Body age': {
    defaultLabel: 'body_age',
    labelCandidates: ['body_age'],
    parser: 'number',
  },
  'Skeletal Muscle': {
    defaultLabel: 'skeletal_muscle_percent',
    labelCandidates: ['skeletal_muscle_percent', 'skeletal_muscle'],
    parser: 'number',
  },
  'Muscle ratio': {
    defaultLabel: 'muscle_ratio_percent',
    labelCandidates: ['muscle_ratio_percent', 'muscle_ratio'],
    parser: 'number',
  },
};

const FORMAT_DEFINITIONS = [
  {
    id: 'insmart_health_history',
    name: 'INSMART Health History',
    timestampColumn: 'time',
    requiredHeaders: ['time', 'Weight', 'BMI'],
    columns: INS_MART_COLUMNS,
  },
];

const parseCsvText = (text) => new Promise((resolve, reject) => {
  const rows = [];
  let headers = [];

  parseString(stripBom(text), {
    headers: (parsedHeaders) => parsedHeaders.map((header) => stripBom(header).trim()),
    ignoreEmpty: true,
    trim: true,
  })
    .on('error', reject)
    .on('headers', (parsedHeaders) => {
      headers = parsedHeaders.map((header) => stripBom(header).trim());
    })
    .on('data', (row) => {
      rows.push(row);
    })
    .on('end', () => {
      resolve({ headers, rows });
    });
});

const findHeader = (headers, wanted) => {
  const normalizedWanted = normalizeHeader(wanted);
  return headers.find((header) => normalizeHeader(header) === normalizedWanted) || '';
};

const detectKnownFormat = (headers) => {
  let best = null;

  FORMAT_DEFINITIONS.forEach((format) => {
    const requiredMatches = format.requiredHeaders.filter((header) => findHeader(headers, header)).length;
    const knownMatches = Object.keys(format.columns).filter((header) => findHeader(headers, header)).length;
    const requiredOk = requiredMatches === format.requiredHeaders.length;
    const score = (requiredMatches * 20) + knownMatches;
    if (requiredOk && (!best || score > best.score)) {
      best = { format, score };
    }
  });

  return best ? best.format : null;
};

const detectTimestampColumn = (headers) => {
  const candidates = ['time', 'timestamp', 'datetime', 'date time', 'date', 'created_at', 'created at'];
  return candidates.map((candidate) => findHeader(headers, candidate)).find(Boolean) || '';
};

const buildGenericFormat = (headers) => {
  const timestampColumn = detectTimestampColumn(headers);
  if (!timestampColumn) return null;

  const columns = {};
  headers.forEach((header) => {
    if (header === timestampColumn) return;
    columns[header] = {
      defaultLabel: toSnakeCase(header),
      labelCandidates: [toSnakeCase(header)],
      parser: 'number',
    };
  });

  return {
    id: 'generic_numeric_csv',
    name: 'Generic numeric CSV',
    timestampColumn,
    requiredHeaders: [timestampColumn],
    columns,
  };
};

const detectCsvFormat = (headers) => {
  const knownFormat = detectKnownFormat(headers);
  if (knownFormat) return knownFormat;

  const genericFormat = buildGenericFormat(headers);
  if (genericFormat) return genericFormat;

  throw new Error('Unable to detect this CSV format. Add a time/date column or a format definition first.');
};

const parseNumericValue = (value) => {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw || raw === '--' || raw.toLowerCase() === 'nan') return '';
  const normalized = raw.replace(/\s+/g, '');
  const match = normalized.match(/[-+]?\d+(?:[.,]\d+)?/);
  if (!match) return '';
  return match[0].replace(',', '.');
};

const parseTimestampValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value || '').trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ymd) {
    const [, year, month, day, hour = '12', minute = '00', second = '00'] = ymd;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mdy) {
    const [, month, day, year, hour = '12', minute = '00', second = '00'] = mdy;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const collectSampleValues = (rows, source) => {
  const values = [];
  rows.forEach((row) => {
    if (values.length >= MAX_SAMPLE_VALUES) return;
    const value = row[source];
    if (value === null || value === undefined || String(value).trim() === '') return;
    values.push(String(value).trim());
  });
  return values;
};

const matchExistingLabel = (source, rule, existingLabels = []) => {
  const labels = Array.isArray(existingLabels) ? existingLabels.filter(Boolean) : [];
  const candidates = [
    ...(rule?.labelCandidates || []),
    rule?.defaultLabel || '',
    source,
    toSnakeCase(source),
  ].filter(Boolean);
  const candidateKeys = new Set(candidates.map(normalizeLabelKey));

  const exactCandidate = candidates.find((candidate) => labels.includes(candidate));
  if (exactCandidate) return exactCandidate;

  const matchingExisting = labels.find((label) => candidateKeys.has(normalizeLabelKey(label)));
  if (matchingExisting) return matchingExisting;

  return rule?.defaultLabel || toSnakeCase(source);
};

const getRuleForSource = (format, source) => {
  const direct = format.columns[source];
  if (direct) return direct;
  const formatHeader = Object.keys(format.columns).find((header) => normalizeHeader(header) === normalizeHeader(source));
  if (formatHeader) return format.columns[formatHeader];
  return {
    defaultLabel: toSnakeCase(source),
    labelCandidates: [toSnakeCase(source)],
    parser: 'number',
  };
};

const buildColumnPreview = ({ format, headers, rows, existingLabels }) => headers
  .filter((header) => normalizeHeader(header) !== normalizeHeader(format.timestampColumn))
  .map((source) => {
    const rule = getRuleForSource(format, source);
    const sampleValues = collectSampleValues(rows, source);
    const parsedSampleValues = rule.parser === 'number'
      ? sampleValues.map((sample) => parseNumericValue(sample)).filter(Boolean)
      : [];
    const hasNumericSamples = parsedSampleValues.length > 0;
    const enabled = rule.defaultEnabled !== undefined
      ? rule.defaultEnabled
      : rule.parser === 'number' && hasNumericSamples;
    const targetLabel = enabled ? matchExistingLabel(source, rule, existingLabels) : '';

    return {
      source,
      targetLabel,
      entryType: rule.entryType || 'basic',
      parser: rule.parser || 'number',
      enabled,
      ignoreReason: rule.ignoreReason || '',
      sampleValues,
      parsedSampleValues,
    };
  });

const buildLifeLogImportPreview = async (text, { existingLabels = [] } = {}) => {
  const { headers, rows } = await parseCsvText(text);
  if (!headers.length) {
    throw new Error('No CSV headers found.');
  }

  const format = detectCsvFormat(headers);
  const timestampColumn = findHeader(headers, format.timestampColumn) || format.timestampColumn;
  const validRows = rows.filter((row) => parseTimestampValue(row[timestampColumn]));
  const validDates = validRows
    .map((row) => parseTimestampValue(row[timestampColumn]))
    .filter(Boolean)
    .sort((a, b) => a - b);

  return {
    formatId: format.id,
    formatName: format.name,
    timestampColumn,
    rowCount: rows.length,
    validRowCount: validRows.length,
    invalidRowCount: rows.length - validRows.length,
    firstDate: validDates.length ? formatDateLocal(validDates[0]) : '',
    lastDate: validDates.length ? formatDateLocal(validDates[validDates.length - 1]) : '',
    columns: buildColumnPreview({ format: { ...format, timestampColumn }, headers, rows, existingLabels }),
  };
};

const normalizeMappings = (mappings = []) => mappings
  .map((mapping) => ({
    source: String(mapping?.source || '').trim(),
    targetLabel: String(mapping?.targetLabel || '').trim(),
    entryType: ['basic', 'medical'].includes(mapping?.entryType) ? mapping.entryType : 'basic',
    enabled: mapping?.enabled === true,
  }))
  .filter((mapping) => mapping.source && mapping.enabled && mapping.targetLabel);

const buildLifeLogImportRecords = async (text, { mappings = [] } = {}) => {
  const { headers, rows } = await parseCsvText(text);
  if (!headers.length) {
    throw new Error('No CSV headers found.');
  }

  const format = detectCsvFormat(headers);
  const timestampColumn = findHeader(headers, format.timestampColumn) || format.timestampColumn;
  const activeMappings = normalizeMappings(mappings);
  const records = [];
  let invalidRows = 0;
  let emptyRows = 0;

  rows.forEach((row, index) => {
    const timestamp = parseTimestampValue(row[timestampColumn]);
    if (!timestamp) {
      invalidRows += 1;
      return;
    }

    const values = activeMappings
      .map((mapping) => {
        const rawValue = row[mapping.source];
        const parsedValue = parseNumericValue(rawValue);
        if (!parsedValue) return null;
        return {
          source: mapping.source,
          label: mapping.targetLabel,
          type: mapping.entryType,
          value: parsedValue,
        };
      })
      .filter(Boolean);

    if (!values.length) {
      emptyRows += 1;
      return;
    }

    records.push({
      sourceRow: index + 2,
      timestamp,
      dateKey: formatDateLocal(timestamp),
      values,
    });
  });

  return {
    formatId: format.id,
    formatName: format.name,
    timestampColumn,
    rowCount: rows.length,
    invalidRows,
    emptyRows,
    records,
  };
};

module.exports = {
  buildLifeLogImportPreview,
  buildLifeLogImportRecords,
  detectCsvFormat,
  parseCsvText,
  parseNumericValue,
  parseTimestampValue,
  formatDateLocal,
};
