const {
  buildLifeLogImportPreview,
  buildLifeLogImportRecords,
  parseNumericValue,
} = require('../../services/myLifeLogCsvImportService');

describe('myLifeLogCsvImportService', () => {
  const insmartCsv = [
    'time,Weight,BMI,Body fat,Body Type,Heart Rate',
    '2026-05-14 07:41:43,70.6kg,22.3,14.7%,Standard,--',
    '2026-04-28 08:14:55,68.9kg,21.7,13.8%,Standard,--',
  ].join('\n');

  test('detects INSMART health history columns and defaults mapping', async () => {
    const preview = await buildLifeLogImportPreview(insmartCsv, {
      existingLabels: ['weight_kg', 'bmi'],
    });

    expect(preview.formatId).toBe('insmart_health_history');
    expect(preview.rowCount).toBe(2);
    expect(preview.validRowCount).toBe(2);

    const weight = preview.columns.find((column) => column.source === 'Weight');
    expect(weight).toMatchObject({
      targetLabel: 'weight_kg',
      enabled: true,
    });
    expect(weight.parsedSampleValues[0]).toBe('70.6');

    const bodyType = preview.columns.find((column) => column.source === 'Body Type');
    expect(bodyType.enabled).toBe(false);
    expect(bodyType.ignoreReason).toBe('Text column');

    const heartRate = preview.columns.find((column) => column.source === 'Heart Rate');
    expect(heartRate.enabled).toBe(false);
    expect(heartRate.ignoreReason).toBe('Ignored by default');
  });

  test('builds numeric life log records from enabled mappings', async () => {
    const parsed = await buildLifeLogImportRecords(insmartCsv, {
      mappings: [
        { source: 'Weight', targetLabel: 'weight_kg', entryType: 'basic', enabled: true },
        { source: 'BMI', targetLabel: 'bmi', entryType: 'basic', enabled: true },
        { source: 'Body Type', targetLabel: 'body_type', entryType: 'basic', enabled: true },
      ],
    });

    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0].dateKey).toBe('2026-05-14');
    expect(parsed.records[0].values).toEqual([
      { source: 'Weight', label: 'weight_kg', type: 'basic', value: '70.6' },
      { source: 'BMI', label: 'bmi', type: 'basic', value: '22.3' },
    ]);
  });

  test('parses numeric values without unit suffixes', () => {
    expect(parseNumericValue('70.6kg')).toBe('70.6');
    expect(parseNumericValue('14.7%')).toBe('14.7');
    expect(parseNumericValue('--')).toBe('');
  });
});
