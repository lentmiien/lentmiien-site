jest.mock('../../database', () => ({ OcrJob: {} }));
jest.mock('../../services/embeddingApiService', () => jest.fn().mockImplementation(() => ({
  embed: jest.fn(),
  deleteEmbeddings: jest.fn(),
})));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const {
  OcrEmbeddingService,
  buildOcrEmbeddingMetadata,
  isEmbeddingDue,
  isRetryableEmbeddingError,
} = require('../../services/ocrEmbeddingService');

function queryReturning(rows) {
  const query = {
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(rows),
  };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
}

function makeJob(fileOverrides = {}) {
  return {
    _id: 'job-1',
    status: 'completed',
    files: [{
      id: 'file-1',
      status: 'completed',
      embeddingStatus: 'pending',
      embeddingAttempts: 0,
      embeddingRetryable: true,
      result: { layoutText: 'Recognized OCR text' },
      ...fileOverrides,
    }],
  };
}

describe('OcrEmbeddingService', () => {
  const fixedNow = new Date('2026-08-11T04:00:00.000Z');

  test('stores pending OCR embeddings only from the background reconciliation pass', async () => {
    const job = makeJob();
    const query = queryReturning([job]);
    const ocrJobModel = {
      find: jest.fn().mockReturnValue(query),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const embeddingService = {
      embed: jest.fn().mockResolvedValue({ vectors: [[0.1, 0.2]] }),
      deleteEmbeddings: jest.fn(),
    };
    const service = new OcrEmbeddingService({
      ocrJobModel,
      embeddingService,
      now: () => fixedNow,
    });

    await expect(service.reconcile()).resolves.toEqual({ processed: 1, failed: 0 });

    expect(embeddingService.embed).toHaveBeenCalledWith(
      ['Recognized OCR text'],
      {},
      [{
        collectionName: 'ocr_job_files',
        documentId: 'file-1',
        contentType: 'ocr_layout_text',
        parentCollection: 'ocr_job',
        parentId: 'job-1',
      }],
    );
    expect(ocrJobModel.updateOne).toHaveBeenCalledTimes(2);
    expect(ocrJobModel.updateOne.mock.calls[1][1]).toEqual({
      $set: expect.objectContaining({
        'files.$.embeddingStatus': 'completed',
        'files.$.embeddingRetryable': false,
        'files.$.embeddingError': null,
      }),
    });
  });

  test('persists timeout retries with exponential backoff instead of failing the OCR job', async () => {
    const job = makeJob({ embeddingAttempts: 1 });
    const timeoutError = Object.assign(new Error('Embedding API request timed out'), { code: 'ETIMEOUT' });
    const ocrJobModel = {
      find: jest.fn().mockReturnValue(queryReturning([job])),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const service = new OcrEmbeddingService({
      ocrJobModel,
      embeddingService: {
        embed: jest.fn().mockRejectedValue(timeoutError),
        deleteEmbeddings: jest.fn(),
      },
      now: () => fixedNow,
      retryBaseMs: 1000,
      retryMaxMs: 10000,
      maxAttempts: 5,
    });

    await expect(service.reconcile()).resolves.toEqual({ processed: 0, failed: 1 });

    expect(ocrJobModel.updateOne.mock.calls[1][1]).toEqual({
      $set: expect.objectContaining({
        'files.$.embeddingStatus': 'failed',
        'files.$.embeddingRetryable': true,
        'files.$.embeddingNextAttemptAt': new Date('2026-08-11T04:00:02.000Z'),
      }),
    });
  });

  test('recognizes missing, due retry, and stale processing records for restart reconciliation', () => {
    const options = { maxAttempts: 5, processingStaleMs: 10 * 60 * 1000 };
    expect(isEmbeddingDue(makeJob({ embeddingStatus: undefined }).files[0], fixedNow, options)).toBe(true);
    expect(isEmbeddingDue(makeJob({
      embeddingStatus: 'failed',
      embeddingAttempts: 2,
      embeddingNextAttemptAt: new Date(fixedNow.getTime() - 1),
    }).files[0], fixedNow, options)).toBe(true);
    expect(isEmbeddingDue(makeJob({
      embeddingStatus: 'processing',
      embeddingUpdatedAt: new Date(fixedNow.getTime() - 11 * 60 * 1000),
    }).files[0], fixedNow, options)).toBe(true);
    expect(isEmbeddingDue(makeJob({ embeddingStatus: 'completed' }).files[0], fixedNow, options)).toBe(false);
  });

  test('classifies timeout and transient HTTP errors for retry', () => {
    expect(isRetryableEmbeddingError({ code: 'ETIMEOUT' })).toBe(true);
    expect(isRetryableEmbeddingError({ status: 503 })).toBe(true);
    expect(isRetryableEmbeddingError({ status: 400 })).toBe(false);
    expect(buildOcrEmbeddingMetadata({ _id: 'job' }, { id: 'file' })).toMatchObject({
      documentId: 'file',
      parentId: 'job',
    });
  });
});
