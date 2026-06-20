const mockQuery = (value = []) => ({
  lean: jest.fn().mockResolvedValue(value),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
});

const mockLifeLogEntry = jest.fn();
mockLifeLogEntry.find = jest.fn(() => mockQuery([]));
mockLifeLogEntry.insertMany = jest.fn();

const mockHealthEntry = jest.fn();
mockHealthEntry.find = jest.fn(() => mockQuery([]));

jest.mock('../../database', () => ({
  MyLifeLogEntry: mockLifeLogEntry,
  HealthEntry: mockHealthEntry,
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
}));

const { MyLifeLogService } = require('../../services/myLifeLogService');

describe('MyLifeLogService CSV import', () => {
  let service;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = { error: jest.fn(), warning: jest.fn() };
    mockLifeLogEntry.find.mockReturnValue(mockQuery([]));
    mockLifeLogEntry.insertMany.mockResolvedValue([]);
    mockHealthEntry.find.mockReturnValue(mockQuery([]));
    service = new MyLifeLogService({
      LifeLogEntry: mockLifeLogEntry,
      HealthEntry: mockHealthEntry,
      logger,
    });
  });

  test('skips existing same-date labels and imports remaining values', async () => {
    const timestamp = new Date(2026, 4, 14, 7, 41, 43);
    mockLifeLogEntry.find.mockReturnValueOnce(mockQuery([
      { label: 'weight_kg', timestamp: new Date(2026, 4, 14, 8, 0, 0) },
    ]));
    mockHealthEntry.find.mockReturnValueOnce(mockQuery([]));
    mockLifeLogEntry.insertMany.mockResolvedValueOnce([
      { label: 'bmi', timestamp },
    ]);

    const result = await service.importCsvRecords({
      records: [{
        sourceRow: 2,
        timestamp,
        dateKey: '2026-05-14',
        values: [
          { label: 'weight_kg', value: '70.6', type: 'basic', source: 'Weight' },
          { label: 'bmi', value: '22.3', type: 'basic', source: 'BMI' },
        ],
      }],
    });

    expect(mockLifeLogEntry.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'basic',
        label: 'bmi',
        value: '22.3',
        timestamp,
      }),
    ], { ordered: false });
    expect(result).toMatchObject({
      importedEntries: 1,
      duplicateEntries: 1,
      duplicateRows: 1,
      skippedRows: 0,
    });
  });

  test('treats legacy health labels as duplicates', async () => {
    const timestamp = new Date(2026, 3, 28, 8, 14, 55);
    mockLifeLogEntry.find.mockReturnValueOnce(mockQuery([]));
    mockHealthEntry.find.mockReturnValueOnce(mockQuery([
      {
        dateOfEntry: '2026-04-28',
        basicData: new Map([['weight_kg', '68.9']]),
        medicalRecord: new Map(),
      },
    ]));

    const result = await service.importCsvRecords({
      records: [{
        sourceRow: 3,
        timestamp,
        dateKey: '2026-04-28',
        values: [
          { label: 'weight_kg', value: '68.9', type: 'basic', source: 'Weight' },
        ],
      }],
    });

    expect(mockLifeLogEntry.insertMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      importedEntries: 0,
      duplicateEntries: 1,
      skippedRows: 1,
    });
  });

  test('deduplicates source-id imports without same-day label collapsing', async () => {
    const firstTimestamp = new Date(2026, 5, 19, 8, 0, 0);
    const secondTimestamp = new Date(2026, 5, 19, 9, 0, 0);
    mockLifeLogEntry.find.mockReturnValueOnce(mockQuery([
      { sourceId: 'samsung-health:heart-rate:existing:heart_rate_bpm' },
    ]));
    mockLifeLogEntry.insertMany.mockResolvedValueOnce([
      { label: 'heart_rate_bpm', timestamp: secondTimestamp },
    ]);

    const result = await service.importCsvRecords({
      records: [
        {
          sourceRow: 2,
          timestamp: firstTimestamp,
          dateKey: '2026-06-19',
          values: [
            {
              label: 'heart_rate_bpm',
              value: '70',
              type: 'basic',
              sourceId: 'samsung-health:heart-rate:existing:heart_rate_bpm',
              importSource: 'samsung_health',
            },
          ],
        },
        {
          sourceRow: 3,
          timestamp: secondTimestamp,
          dateKey: '2026-06-19',
          values: [
            {
              label: 'heart_rate_bpm',
              value: '72',
              type: 'basic',
              sourceId: 'samsung-health:heart-rate:new:heart_rate_bpm',
              importSource: 'samsung_health',
            },
          ],
        },
      ],
    });

    expect(mockHealthEntry.find).not.toHaveBeenCalled();
    expect(mockLifeLogEntry.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'basic',
        label: 'heart_rate_bpm',
        value: '72',
        source: 'samsung_health',
        sourceId: 'samsung-health:heart-rate:new:heart_rate_bpm',
        timestamp: secondTimestamp,
      }),
    ], { ordered: false });
    expect(result).toMatchObject({
      importedEntries: 1,
      duplicateEntries: 1,
      skippedRows: 1,
    });
  });
});
