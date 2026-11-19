const { privatizeLegacyScan } = require('../../services/legacyReceiptScan');

function fixture() {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const row = { _id: '507f191e810c19729de860ea', file: 'UP-1111111111.jpg' };
  const model = {
    findOne: () => ({ select: () => Promise.resolve({ ...row }) }),
    exists: jest.fn(async () => null),
    updateOne: jest.fn(async (_filter, update) => {
      Object.assign(row, update.$set);
      if (update.$unset) delete row.file;
    }),
  };
  const options = { model, read: jest.fn(async () => jpeg), remove: jest.fn(async () => {}), apply: true };
  return { jpeg, row, model, options };
}

test('inspection is read-only, application verifies the exact private copy before removing an identified public file', async () => {
  const { row, options, model, jpeg } = fixture();
  expect(await privatizeLegacyScan(row._id, { ...options, apply: false })).toBe('eligible');
  expect(model.updateOne).not.toHaveBeenCalled();
  expect(options.remove).not.toHaveBeenCalled();
  expect(await privatizeLegacyScan(row._id, options)).toBe('private');
  expect(row.scanJpeg).toEqual(jpeg);
  expect(options.remove).toHaveBeenCalledWith('UP-1111111111.jpg');
  expect(model.updateOne.mock.calls[0][2]).toEqual({ writeConcern: { w: 'majority', j: true } });
  expect(await privatizeLegacyScan(row._id, options)).toBe('already_private');
  expect(options.remove).toHaveBeenCalledTimes(1);
});

test('a shared name, failed private save, or changed public file leaves the public scan intact', async () => {
  const { row, options, model, jpeg } = fixture();
  model.exists.mockResolvedValueOnce({ _id: 'other' });
  await expect(privatizeLegacyScan(row._id, options)).rejects.toThrow('Multiple');
  model.updateOne.mockRejectedValueOnce(new Error('unavailable'));
  await expect(privatizeLegacyScan(row._id, options)).rejects.toThrow();
  options.read.mockResolvedValueOnce(jpeg).mockResolvedValueOnce(Buffer.from('changed'));
  await expect(privatizeLegacyScan(row._id, options)).rejects.toThrow('changed');
  expect(options.remove).not.toHaveBeenCalled();
});

test('resumes after interruption following public removal and rejects unknown names', async () => {
  const { row, options, jpeg } = fixture();
  row.scanJpeg = jpeg;
  options.read.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));
  expect(await privatizeLegacyScan(row._id, options)).toBe('private');
  expect(options.remove).not.toHaveBeenCalled();
  row.file = '../other.jpg';
  await expect(privatizeLegacyScan(row._id, options)).rejects.toThrow('Unrecognized');
});
