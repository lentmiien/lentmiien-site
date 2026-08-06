jest.mock('axios', () => ({
  post: jest.fn(),
}));

const axios = require('axios');
const {
  PUSHOVER_PRIORITIES,
  sendPushoverNotification,
} = require('../../utils/pushover');

const originalEnv = { ...process.env };

describe('Pushover notification utility', () => {
  beforeEach(() => {
    process.env.PUSHOVER_APP_TOKEN = 'app-token';
    process.env.PUSHOVER_USER_KEY = 'user-key';
    axios.post.mockResolvedValue({
      data: { status: 1, request: 'request-id' },
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  test('sends a medium-priority notification by default', async () => {
    await expect(sendPushoverNotification({
      title: 'Batch complete',
      message: 'Batch batch_123 completed.',
    })).resolves.toEqual({ status: 1, request: 'request-id' });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];

    expect(url).toBe('https://api.pushover.net/1/messages.json');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(body.entries())).toEqual({
      token: 'app-token',
      user: 'user-key',
      message: 'Batch batch_123 completed.',
      priority: String(PUSHOVER_PRIORITIES.MEDIUM),
      title: 'Batch complete',
    });
    expect(options).toEqual({
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10_000,
    });
  });

  test('supports lower-priority notifications', async () => {
    await sendPushoverNotification({
      message: 'Background task finished.',
      priority: PUSHOVER_PRIORITIES.LOW,
    });

    const body = axios.post.mock.calls[0][1];
    expect(body.get('priority')).toBe('-1');
  });

  test('includes the retry settings required for emergency notifications', async () => {
    await sendPushoverNotification({
      message: 'Immediate attention required.',
      priority: PUSHOVER_PRIORITIES.EMERGENCY,
      retry: 30,
      expire: 1_800,
    });

    const body = axios.post.mock.calls[0][1];
    expect(body.get('priority')).toBe('2');
    expect(body.get('retry')).toBe('30');
    expect(body.get('expire')).toBe('1800');
  });

  test('requires both Pushover credentials', async () => {
    delete process.env.PUSHOVER_USER_KEY;

    await expect(sendPushoverNotification({
      message: 'Test message',
    })).rejects.toThrow('set PUSHOVER_USER_KEY');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects unsupported priorities before sending', async () => {
    await expect(sendPushoverNotification({
      message: 'Test message',
      priority: 3,
    })).rejects.toThrow('priority must be between -2 and 2');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects unsuccessful API responses', async () => {
    axios.post.mockResolvedValue({
      data: { status: 0, errors: ['invalid token'] },
    });

    await expect(sendPushoverNotification({
      message: 'Test message',
    })).rejects.toThrow('Pushover rejected the notification');
  });
});
