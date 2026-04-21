const { InvalidWebhookSignatureError } = require('openai');

const { unwrapOpenAIWebhook } = require('../../utils/openaiWebhook');

describe('unwrapOpenAIWebhook', () => {
  test('retries with fallback tolerance when webhook timestamp is too old', async () => {
    const loggerInstance = {
      warning: jest.fn(),
    };
    const headers = {
      'webhook-timestamp': String(Math.floor(Date.now() / 1000) - 1200),
    };
    const client = {
      webhooks: {
        unwrap: jest.fn()
          .mockRejectedValueOnce(new InvalidWebhookSignatureError('Webhook timestamp is too old'))
          .mockResolvedValueOnce({ id: 'evt_123', type: 'response.completed' }),
      },
    };

    const event = await unwrapOpenAIWebhook({
      client,
      payload: '{"ok":true}',
      headers,
      secret: 'whsec_test',
      strictToleranceSeconds: 300,
      fallbackToleranceSeconds: 3600,
      loggerInstance,
    });

    expect(event).toEqual({ id: 'evt_123', type: 'response.completed' });
    expect(client.webhooks.unwrap).toHaveBeenNthCalledWith(1, '{"ok":true}', headers, 'whsec_test', 300);
    expect(client.webhooks.unwrap).toHaveBeenNthCalledWith(2, '{"ok":true}', headers, 'whsec_test', 3600);
    expect(loggerInstance.warning).toHaveBeenCalledTimes(2);
  });

  test('does not retry non-timestamp webhook signature errors', async () => {
    const client = {
      webhooks: {
        unwrap: jest.fn().mockRejectedValue(new InvalidWebhookSignatureError('The given webhook signature does not match the expected signature')),
      },
    };

    await expect(unwrapOpenAIWebhook({
      client,
      payload: '{}',
      headers: {},
      secret: 'whsec_test',
      strictToleranceSeconds: 300,
      fallbackToleranceSeconds: 3600,
      loggerInstance: { warning: jest.fn() },
    })).rejects.toThrow('The given webhook signature does not match the expected signature');

    expect(client.webhooks.unwrap).toHaveBeenCalledTimes(1);
  });
});
