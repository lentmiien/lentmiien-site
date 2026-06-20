const {
  MyLifeLogSamsungHealthImportService,
  getLastFullDayEnd,
  parseSamsungZip,
} = require('../../services/myLifeLogSamsungHealthImportService');

const writeUInt16 = (buffer, value, offset) => buffer.writeUInt16LE(value, offset);
const writeUInt32 = (buffer, value, offset) => buffer.writeUInt32LE(value, offset);

const createStoredZip = (entries) => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  entries.forEach(({ name, content }) => {
    const nameBuffer = Buffer.from(name, 'utf8');
    const dataBuffer = Buffer.from(content, 'utf8');
    const localHeader = Buffer.alloc(30);
    writeUInt32(localHeader, 0x04034b50, 0);
    writeUInt16(localHeader, 20, 4);
    writeUInt16(localHeader, 0x0800, 6);
    writeUInt16(localHeader, 0, 8);
    writeUInt32(localHeader, 0, 10);
    writeUInt32(localHeader, 0, 14);
    writeUInt32(localHeader, dataBuffer.length, 18);
    writeUInt32(localHeader, dataBuffer.length, 22);
    writeUInt16(localHeader, nameBuffer.length, 26);
    writeUInt16(localHeader, 0, 28);
    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    writeUInt32(centralHeader, 0x02014b50, 0);
    writeUInt16(centralHeader, 20, 4);
    writeUInt16(centralHeader, 20, 6);
    writeUInt16(centralHeader, 0x0800, 8);
    writeUInt16(centralHeader, 0, 10);
    writeUInt32(centralHeader, 0, 12);
    writeUInt32(centralHeader, 0, 16);
    writeUInt32(centralHeader, dataBuffer.length, 20);
    writeUInt32(centralHeader, dataBuffer.length, 24);
    writeUInt16(centralHeader, nameBuffer.length, 28);
    writeUInt16(centralHeader, 0, 30);
    writeUInt16(centralHeader, 0, 32);
    writeUInt32(centralHeader, 0, 34);
    writeUInt32(centralHeader, 0, 38);
    writeUInt32(centralHeader, localOffset, 42);
    centralParts.push(centralHeader, nameBuffer);

    localOffset += localHeader.length + nameBuffer.length + dataBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  writeUInt32(eocd, 0x06054b50, 0);
  writeUInt16(eocd, 0, 4);
  writeUInt16(eocd, 0, 6);
  writeUInt16(eocd, entries.length, 8);
  writeUInt16(eocd, entries.length, 10);
  writeUInt32(eocd, centralDirectory.length, 12);
  writeUInt32(eocd, localOffset, 16);
  writeUInt16(eocd, 0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
};

const samsungWeightCsv = [
  'com.samsung.health.weight,6320001,12',
  'start_time,time_offset,datauuid,weight,body_fat',
  '2026-06-19 23:00:00.000,UTC+0900,weight-1,75.4,17.0,',
  '2026-06-20 01:00:00.000,UTC+0900,weight-2,75.2,16.8,',
  '1970-01-01 00:00:00.000,UTC+0900,placeholder,74.0,16.0,',
].join('\n');

describe('myLifeLogSamsungHealthImportService', () => {
  test('calculates the previous full day cutoff', () => {
    const cutoff = getLastFullDayEnd(new Date(2026, 5, 20, 11, 3, 0));
    expect(cutoff).toEqual(new Date(2026, 5, 19, 23, 59, 59, 999));
  });

  test('previews Samsung Health CSV rows inside the import window', async () => {
    const zip = createStoredZip([{
      name: 'Samsung Health/samsunghealth_user_20260620/com.samsung.health.weight.20260620.csv',
      content: samsungWeightCsv,
    }]);

    const preview = await parseSamsungZip(zip, {
      windowEnd: new Date(2026, 5, 19, 23, 59, 59, 999),
      includeRecords: true,
    });

    expect(preview.csvFileCount).toBe(1);
    expect(preview.supportedFileCount).toBe(1);
    expect(preview.eligibleRowCount).toBe(1);
    expect(preview.afterWindowRows).toBe(1);
    expect(preview.invalidRows).toBe(1);
    expect(preview.importableEntryCount).toBe(2);
    expect(preview.firstDate).toBe('2026-06-19');
    expect(preview.lastDate).toBe('2026-06-19');
    expect(preview.records[0].values).toEqual([
      expect.objectContaining({ label: 'weight_kg', value: '75.4', type: 'basic' }),
      expect.objectContaining({ label: 'body_fat_percent', value: '17.0', type: 'basic' }),
    ]);
  });

  test('starts after the stored Samsung Health checkpoint', async () => {
    const zip = createStoredZip([{
      name: 'Samsung Health/samsunghealth_user_20260620/com.samsung.health.weight.20260620.csv',
      content: samsungWeightCsv,
    }]);
    const ImportState = {
      findOne: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue({
          importedThrough: new Date(2026, 5, 19, 23, 59, 59, 999),
        }),
      })),
      findOneAndUpdate: jest.fn().mockResolvedValue({}),
    };
    const service = new MyLifeLogSamsungHealthImportService({ ImportState });

    const parsed = await service.buildImportRecords(zip, {
      now: new Date(2026, 5, 21, 11, 3, 0),
    });

    expect(parsed.windowStart).toEqual(new Date(2026, 5, 20, 0, 0, 0, 0));
    expect(parsed.windowEnd).toEqual(new Date(2026, 5, 20, 23, 59, 59, 999));
    expect(parsed.beforeWindowRows).toBe(1);
    expect(parsed.eligibleRowCount).toBe(1);
    expect(parsed.records[0].dateKey).toBe('2026-06-20');
  });
});
