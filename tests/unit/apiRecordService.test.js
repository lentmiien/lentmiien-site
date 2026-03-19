const ApiRecordService = require('../../services/apiRecordService');

const encryptedSecret = {
  v: 1,
  alg: 'aes-256-gcm',
  kid: 'key-1',
  iv: 'iv-1',
  tag: 'tag-1',
  ct: 'ciphertext-1',
};

const createLeanQuery = (result) => ({
  exec: jest.fn().mockResolvedValue(result),
});

const createSortChain = (result) => {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  const sort = jest.fn().mockReturnValue({ lean, exec });
  return { sort, lean, exec };
};

describe('ApiRecordService', () => {
  let ApiRecordModel;
  let service;

  beforeEach(() => {
    ApiRecordModel = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue(),
      toObject: jest.fn().mockReturnValue({ ...doc }),
    }));

    ApiRecordModel.findOneAndUpdate = jest.fn();
    ApiRecordModel.findOne = jest.fn();
    ApiRecordModel.find = jest.fn();
    ApiRecordModel.deleteOne = jest.fn();

    service = new ApiRecordService(ApiRecordModel);
  });

  test('upsertBatch creates a new entry with provided historic timestamps', async () => {
    const createdAt = '2022-01-02T03:04:05.000Z';
    const result = await service.upsertBatch(
      [
        {
          id: null,
          order: 7,
          customer: 'Acme',
          title: 'Historic import',
          fields: { plain: 'value' },
          encryptedFields: { secret: encryptedSecret },
          createdAt,
        },
      ],
      { tier: 'tier2' },
      { now: new Date('2026-01-01T00:00:00.000Z') }
    );

    expect(ApiRecordModel).toHaveBeenCalledTimes(1);
    expect(ApiRecordModel).toHaveBeenCalledWith(expect.objectContaining({
      _id: expect.any(String),
      order: 7,
      customer: 'Acme',
      title: 'Historic import',
      rev: 0,
      fields: { plain: 'value' },
      encryptedFields: { secret: encryptedSecret },
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    }));

    const instance = ApiRecordModel.mock.results[0].value;
    expect(instance.save).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({ created: 1, updated: 0, failed: 0 });
    expect(result.results[0].status).toBe('created');
    expect(result.results[0].entry.encryptedFields).toEqual({ secret: encryptedSecret });
  });

  test('upsertBatch updates only provided fields and removes null field keys', async () => {
    const updatedDoc = {
      _id: 'rec-1',
      order: 2,
      customer: 'Client',
      tracking: 'TRK-1',
      title: 'Title',
      comment: 'Updated comment',
      next_deadline: new Date('2024-01-20T00:00:00.000Z'),
      completed: false,
      fields: { keep: 'new value' },
      encryptedFields: { secret: encryptedSecret },
      rev: 4,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-03T00:00:00.000Z'),
    };

    const leanQuery = createLeanQuery(updatedDoc);
    ApiRecordModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockReturnValue(leanQuery),
    });

    const result = await service.upsertBatch(
      [
        {
          id: 'rec-1',
          rev: 3,
          comment: 'Updated comment',
          fields: {
            keep: 'new value',
            remove: null,
          },
          updatedAt: '2024-01-03T00:00:00.000Z',
        },
      ],
      { tier: 'tier1' },
      { now: new Date('2026-01-01T00:00:00.000Z') }
    );

    expect(ApiRecordModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'rec-1', rev: 3 },
      {
        $inc: { rev: 1 },
        $set: {
          updatedAt: new Date('2024-01-03T00:00:00.000Z'),
          comment: 'Updated comment',
          'fields.keep': 'new value',
        },
        $unset: {
          'fields.remove': 1,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.summary).toEqual({ created: 0, updated: 1, failed: 0 });
    expect(result.results[0].entry.encryptedFields).toBeUndefined();
  });

  test('upsertBatch reports revision conflicts without aborting the whole batch', async () => {
    ApiRecordModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockReturnValue(createLeanQuery(null)),
    });
    ApiRecordModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue(createLeanQuery({ _id: 'rec-1', rev: 9 })),
    });

    const result = await service.upsertBatch(
      [{ id: 'rec-1', rev: 4, title: 'Mismatch' }],
      { tier: 'tier2' },
      { now: new Date('2026-01-01T00:00:00.000Z') }
    );

    expect(result.success).toBe(false);
    expect(result.summary).toEqual({ created: 0, updated: 0, failed: 1 });
    expect(result.results[0]).toEqual(expect.objectContaining({
      ok: false,
      status: 'error',
      code: 'rev_conflict',
      id: 'rec-1',
    }));
    expect(result.results[0].message).toContain('Current rev is 9');
  });

  test('fetchEntries uses exact title matches and strips encrypted fields for tier1', async () => {
    const records = [
      {
        _id: 'rec-1',
        order: 5,
        customer: 'Customer Corp',
        tracking: 'TRK',
        title: 'Alpha Order',
        comment: 'note',
        next_deadline: new Date('2024-02-01T00:00:00.000Z'),
        completed: false,
        fields: { public: 'data' },
        encryptedFields: { secret: encryptedSecret },
        rev: 1,
        createdAt: new Date('2024-01-10T00:00:00.000Z'),
        updatedAt: new Date('2024-01-11T00:00:00.000Z'),
      },
    ];

    const chain = createSortChain(records);
    ApiRecordModel.find.mockReturnValue({ sort: chain.sort });

    const result = await service.fetchEntries(
      {
        title: 'alpha',
        customer: 'customer',
        order: '5',
        completed: 'false',
        createdAtFrom: '2024-01-01T00:00:00.000Z',
        createdAtTo: '2024-01-31T00:00:00.000Z',
        deadlineTo: '2024-02-01T00:00:00.000Z',
      },
      { tier: 'tier1' }
    );

    const findQuery = ApiRecordModel.find.mock.calls[0][0];

    expect(findQuery).toEqual(expect.objectContaining({
      order: 5,
      completed: false,
      customer: expect.any(RegExp),
      createdAt: {
        $gte: new Date('2024-01-01T00:00:00.000Z'),
        $lte: new Date('2024-01-31T00:00:00.000Z'),
      },
      next_deadline: {
        $lte: new Date('2024-02-01T00:00:00.000Z'),
      },
    }));
    expect(findQuery.title).toEqual(/^alpha$/i);
    expect(findQuery.title.test('Alpha')).toBe(true);
    expect(findQuery.title.test('Credit Card Alpha')).toBe(false);
    expect(result.count).toBe(1);
    expect(result.data[0].encryptedFields).toBeUndefined();
    expect(result.data[0].fields).toEqual({ public: 'data' });
  });

  test('fetchOrderReferencesByTitle returns id and order pairs for an exact title match', async () => {
    const chain = createSortChain([
      { _id: 'rec-1', title: 'Alpha Order', order: 2 },
      { _id: 'rec-2', title: 'Alpha Order', order: 8 },
    ]);
    ApiRecordModel.find.mockReturnValue({ sort: chain.sort });

    const result = await service.fetchOrderReferencesByTitle(' Alpha Order ', { tier: 'tier1' });

    expect(ApiRecordModel.find).toHaveBeenCalledWith({
      title: /^Alpha Order$/i,
    });
    expect(result).toEqual({
      count: 2,
      data: [
        { id: 'rec-1', order: 2 },
        { id: 'rec-2', order: 8 },
      ],
    });
  });

  test('fetchEntryById returns a single serialized record and redacts encrypted fields for tier1', async () => {
    ApiRecordModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue(createLeanQuery({
        _id: 'rec-1',
        order: 5,
        customer: 'Customer Corp',
        tracking: 'TRK',
        title: 'Alpha Order',
        comment: 'note',
        next_deadline: new Date('2024-02-01T00:00:00.000Z'),
        completed: false,
        fields: { public: 'data' },
        encryptedFields: { secret: encryptedSecret },
        rev: 1,
        createdAt: new Date('2024-01-10T00:00:00.000Z'),
        updatedAt: new Date('2024-01-11T00:00:00.000Z'),
      })),
    });

    const result = await service.fetchEntryById('rec-1', { tier: 'tier1' });

    expect(ApiRecordModel.findOne).toHaveBeenCalledWith({ _id: 'rec-1' });
    expect(result).toEqual(expect.objectContaining({
      id: 'rec-1',
      order: 5,
      title: 'Alpha Order',
      fields: { public: 'data' },
    }));
    expect(result.encryptedFields).toBeUndefined();
  });

  test('fetchEntryById throws not_found when the record does not exist', async () => {
    ApiRecordModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue(createLeanQuery(null)),
    });

    await expect(service.fetchEntryById('missing-rec', { tier: 'tier2' })).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      details: { id: 'missing-rec' },
    });
  });

  test('deleteEntry blocks tier1 deletion when encrypted fields exist', async () => {
    ApiRecordModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue(createLeanQuery({
        _id: 'rec-1',
        encryptedFields: { secret: encryptedSecret },
      })),
    });

    await expect(service.deleteEntry('rec-1', { tier: 'tier1' })).rejects.toMatchObject({
      code: 'encrypted_fields_forbidden',
      status: 403,
    });
  });
});
