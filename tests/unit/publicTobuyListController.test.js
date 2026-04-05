jest.mock('../../database', () => {
  const saveMock = jest.fn();
  const Task = jest.fn().mockImplementation(function Task(payload) {
    Object.assign(this, payload);
    this.save = saveMock;
  });
  Task.find = jest.fn();
  Task.__saveMock = saveMock;
  return { Task };
});

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
  notice: jest.fn(),
}));

jest.mock('../../utils/publicTobuyList', () => ({
  PUBLIC_TOBUY_LIST_OWNER: 'Lennart',
  consumePublicTobuyAddQuota: jest.fn(),
}));

const { Task } = require('../../database');
const { consumePublicTobuyAddQuota } = require('../../utils/publicTobuyList');
const controller = require('../../controllers/publicTobuyListController');

function createFindQuery(payload) {
  return {
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(payload),
    }),
  };
}

describe('publicTobuyListController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Task.__saveMock.mockReset();
  });

  test('renderPublicPage loads open Lennart to-buy tasks', async () => {
    Task.find.mockReturnValueOnce(createFindQuery([
      { _id: 'task-1', title: 'Milk' },
      { _id: 'task-2', title: 'Rice' },
    ]));

    const req = {
      query: {},
      baseUrl: '/hidden-path',
      path: '/',
    };
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
    };

    await controller.renderPublicPage(req, res);

    expect(Task.find).toHaveBeenCalledWith({
      userId: 'Lennart',
      type: 'tobuy',
      done: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.render).toHaveBeenCalledWith('public_tobuy_list', expect.objectContaining({
      taskCount: 2,
      submitPath: '/hidden-path',
      tasks: [
        { id: 'task-1', title: 'Milk' },
        { id: 'task-2', title: 'Rice' },
      ],
    }));
  });

  test('addPublicTask saves a trimmed to-buy task for Lennart and redirects back', async () => {
    consumePublicTobuyAddQuota.mockReturnValue({
      allowed: true,
      reason: null,
      retryAfterMs: 0,
      remainingToday: 9,
    });
    Task.__saveMock.mockResolvedValueOnce();

    const req = {
      body: { title: '   Dish soap   ' },
      baseUrl: '/hidden-path',
      path: '/',
    };
    const res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
      locals: {},
    };

    await controller.addPublicTask(req, res);

    expect(consumePublicTobuyAddQuota).toHaveBeenCalledTimes(1);
    expect(Task).toHaveBeenCalledWith({
      userId: 'Lennart',
      type: 'tobuy',
      title: 'Dish soap',
      description: '',
      start: null,
      end: null,
      done: false,
    });
    expect(Task.__saveMock).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith('/hidden-path?added=1');
  });

  test('addPublicTask rerenders with rate limit error when quota is exhausted', async () => {
    consumePublicTobuyAddQuota.mockReturnValue({
      allowed: false,
      reason: 'daily_limit',
      retryAfterMs: 1000,
      remainingToday: 0,
    });
    Task.find.mockReturnValueOnce(createFindQuery([{ _id: 'task-1', title: 'Milk' }]));

    const req = {
      body: { title: 'Eggs' },
      query: {},
      baseUrl: '/hidden-path',
      path: '/',
    };
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
      redirect: jest.fn(),
    };

    await controller.addPublicTask(req, res);

    expect(Task.__saveMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.render).toHaveBeenCalledWith('public_tobuy_list', expect.objectContaining({
      errorMessage: 'The shared add limit for today has been reached.',
      formTitle: 'Eggs',
    }));
  });
});
