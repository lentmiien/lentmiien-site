const HealthService = require('../../services/healthService');

const createEntry = ({
  date = '2024-01-01',
  basic = { weight: '70' },
  medical = { pressure: '120/80' },
  diary = ['msg-1']
} = {}) => ({
  dateOfEntry: date,
  basicData: new Map(Object.entries(basic)),
  medicalRecord: new Map(Object.entries(medical)),
  diary: [...diary],
  save: jest.fn().mockResolvedValue()
});

describe('HealthService', () => {
  let HealthEntry;
  let service;

  beforeEach(() => {
    HealthEntry = jest.fn().mockImplementation((doc = {}) => ({
      ...doc,
      basicData: doc.basicData instanceof Map
        ? doc.basicData
        : new Map(Object.entries(doc.basicData || {})),
      medicalRecord: doc.medicalRecord instanceof Map
        ? doc.medicalRecord
        : new Map(Object.entries(doc.medicalRecord || {})),
      diary: Array.isArray(doc.diary) ? [...doc.diary] : doc.diary || [],
      save: jest.fn().mockResolvedValue()
    }));

    HealthEntry.find = jest.fn();
    HealthEntry.findOne = jest.fn();
    HealthEntry.deleteOne = jest.fn();

    service = new HealthService(HealthEntry);
  });

  test('getAll delegates to find()', async () => {
    const docs = [createEntry(), createEntry({ date: '2024-01-02' })];
    HealthEntry.find.mockResolvedValue(docs);

    const result = await service.getAll();

    expect(HealthEntry.find).toHaveBeenCalledWith();
    expect(result).toBe(docs);
  });

  test('getInRange filters by date boundaries', async () => {
    const docs = [
      createEntry({ date: '2024-01-01' }),
      createEntry({ date: '2024-01-05' }),
      createEntry({ date: '2024-02-01' })
    ];
    HealthEntry.find.mockResolvedValue(docs);

    const result = await service.getInRange('2024-01-02', '2024-01-31');

    expect(result.map((d) => d.dateOfEntry)).toEqual(['2024-01-05']);
  });

  test('updateEntry updates existing record and trims diary', async () => {
    const doc = createEntry({ diary: ['keep'] });
    HealthEntry.findOne.mockResolvedValue(doc);

    const result = await service.updateEntry(
      '2024-01-03',
      { weight: '72' },
      { pressure: '110/70' },
      'id1, id2 , '
    );

    expect(HealthEntry.findOne).toHaveBeenCalledWith({ dateOfEntry: '2024-01-03' });
    expect(doc.basicData).toEqual({ weight: '72' });
    expect(doc.medicalRecord).toEqual({ pressure: '110/70' });
    expect(doc.diary).toEqual(['id1', 'id2']);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(doc);
  });

  test('updateEntry creates new record when missing', async () => {
    HealthEntry.findOne.mockResolvedValue(null);

    const result = await service.updateEntry(
      '2024-01-10',
      { weight: '68' },
      { pressure: '120/80' },
      ''
    );

    expect(HealthEntry).toHaveBeenCalledWith({
      dateOfEntry: '2024-01-10',
      basicData: { weight: '68' },
      medicalRecord: { pressure: '120/80' },
      diary: []
    });
    const instance = HealthEntry.mock.results[0].value;
    expect(instance.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(instance);
  });

  test('updateEntry rejects invalid dates', async () => {
    await expect(
      service.updateEntry('2024/13/01', {}, {}, '')
    ).rejects.toThrow('Invalid date format');
  });

  test('updateEntry wraps underlying errors', async () => {
    HealthEntry.findOne.mockRejectedValue(new Error('db down'));

    await expect(
      service.updateEntry('2024-01-01', {}, {}, '')
    ).rejects.toThrow('Error updating or creating entry: db down');
  });

  test('appendData rejects invalid type', async () => {
    await expect(
      service.appendData([], 'other')
    ).rejects.toThrow("Invalid type. Expected 'basic' or 'medical'.");
  });

  test('appendData rejects invalid date format', async () => {
    await expect(
      service.appendData([{ date: '2024-1-1', dataToAppend: {} }], 'basic')
    ).rejects.toThrow('Invalid date format: 2024-1-1. Expected format is YYYY-MM-DD.');
  });

  test('appendData updates existing entry when values change', async () => {
    const doc = createEntry({
      date: '2024-01-02',
      basic: { weight: '70' }
    });
    HealthEntry.findOne.mockResolvedValueOnce(doc);

    const result = await service.appendData(
      [{ date: '2024-01-02', dataToAppend: { weight: '71', sleep: '7h' } }],
      'basic'
    );

    expect(HealthEntry.findOne).toHaveBeenCalledWith({ dateOfEntry: '2024-01-02' });
    expect(Object.fromEntries(doc.basicData)).toEqual({ weight: '71', sleep: '7h' });
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(result).toEqual([doc]);
  });

  test('appendData skips saving when data identical', async () => {
    const doc = createEntry({
      date: '2024-01-03',
      medical: { pressure: '120/80' }
    });
    HealthEntry.findOne.mockResolvedValueOnce(doc);

    const result = await service.appendData(
      [{ date: '2024-01-03', dataToAppend: { pressure: '120/80' } }],
      'medical'
    );

    expect(doc.save).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('appendData creates new entry when missing', async () => {
    HealthEntry.findOne.mockResolvedValueOnce(null);

    const result = await service.appendData(
      [{ date: '2024-01-04', dataToAppend: { weight: '65' } }],
      'basic'
    );

    const instance = HealthEntry.mock.results[0].value;
    expect(instance.dateOfEntry).toBe('2024-01-04');
    expect(Object.fromEntries(instance.basicData)).toEqual({ weight: '65' });
    expect(Object.fromEntries(instance.medicalRecord)).toEqual({});
    expect(instance.diary).toEqual([]);
    expect(instance.save).toHaveBeenCalledTimes(1);
    expect(result).toEqual([instance]);
  });

  test('appendData wraps errors from database operations', async () => {
    HealthEntry.findOne.mockRejectedValueOnce(new Error('db error'));

    await expect(
      service.appendData([{ date: '2024-01-05', dataToAppend: {} }], 'basic')
    ).rejects.toThrow('Error processing entry for date 2024-01-05: db error');
  });

  test('deleteEntry rejects invalid date', async () => {
    await expect(service.deleteEntry('2024/01/01')).rejects.toThrow('Invalid date format');
  });

  test('deleteEntry raises when no document deleted', async () => {
    HealthEntry.deleteOne.mockResolvedValue({ deletedCount: 0 });

    await expect(
      service.deleteEntry('2024-01-06')
    ).rejects.toThrow('No entry found for date 2024-01-06.');
  });

  test('deleteEntry returns success message on deletion', async () => {
    HealthEntry.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const res = await service.deleteEntry('2024-01-07');

    expect(HealthEntry.deleteOne).toHaveBeenCalledWith({ dateOfEntry: '2024-01-07' });
    expect(res).toEqual({ success: true, message: 'Entry for date 2024-01-07 deleted successfully.' });
  });

  test('deleteEntry wraps underlying delete errors', async () => {
    HealthEntry.deleteOne.mockRejectedValue(new Error('db offline'));

    await expect(
      service.deleteEntry('2024-01-08')
    ).rejects.toThrow('Error deleting entry for date 2024-01-08: db offline');
  });
});
