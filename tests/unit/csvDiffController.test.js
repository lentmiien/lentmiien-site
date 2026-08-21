jest.mock('../../database', () => ({
  ExchangeRate: {},
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn().mockResolvedValue(),
  warning: jest.fn().mockResolvedValue(),
}));

const controller = require('../../controllers/indexcontroller');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    render: jest.fn().mockReturnValue('rendered'),
  };
}

describe('CSV diff controller', () => {
  test('renders an empty comparison form on GET', async () => {
    const res = createResponse();

    await expect(controller.csvDiff({ method: 'GET' }, res)).resolves.toBe('rendered');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.render).toHaveBeenCalledWith('csv_diff', expect.objectContaining({
      pageTitle: 'CSV Diff',
      hasCompared: false,
      comparison: null,
      inputs: expect.objectContaining({ a: '', b: '' }),
    }));
  });

  test('compares posted text even when one side is empty', async () => {
    const res = createResponse();

    await controller.csvDiff({
      method: 'POST',
      body: {
        a: '',
        b: 'id,value\n1,2',
        aDelimiter: 'auto',
        bDelimiter: 'auto',
      },
      files: {},
    }, res);

    const viewModel = res.render.mock.calls[0][1];
    expect(res.status).toHaveBeenCalledWith(200);
    expect(viewModel.hasCompared).toBe(true);
    expect(viewModel.comparison.summary.addedRows).toBe(2);
  });

  test('uses exact uploaded file contents instead of textarea contents', async () => {
    const res = createResponse();
    const left = Buffer.from('\uFEFFa,b\r\n1,2\r\n', 'utf8');
    const right = Buffer.from('a,b\n1,2\n', 'utf8');

    await controller.csvDiff({
      method: 'POST',
      body: {
        a: 'ignored,left',
        b: 'ignored,right',
        aDelimiter: 'auto',
        bDelimiter: 'auto',
      },
      files: {
        aFile: [{ buffer: left, originalname: 'before.csv' }],
        bFile: [{ buffer: right, originalname: 'after.csv' }],
      },
    }, res);

    const viewModel = res.render.mock.calls[0][1];
    expect(viewModel.inputs.a).toBe('\uFEFFa,b\r\n1,2\r\n');
    expect(viewModel.inputs.aFilename).toBe('before.csv');
    expect(viewModel.comparison.summary.contentChanges).toBe(0);
    expect(viewModel.comparison.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'byteOrderMark' }),
      expect.objectContaining({ property: 'lineEnding' }),
    ]));
  });

  test('returns a useful input error for malformed CSV', async () => {
    const res = createResponse();

    await controller.csvDiff({
      method: 'POST',
      body: {
        a: 'a,b\n1,2',
        b: 'a,b\n1,"two',
        aDelimiter: 'auto',
        bDelimiter: 'auto',
      },
      files: {},
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.render).toHaveBeenCalledWith('csv_diff', expect.objectContaining({
      comparison: null,
      errorMessage: expect.stringContaining('Right input: Unclosed quoted field'),
    }));
  });
});
