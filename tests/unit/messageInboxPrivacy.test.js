jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../utils/logger');
const { MessageInboxService } = require('../../services/messageInboxService');

describe('MessageInboxService privacy-safe logging', () => {
  test('does not put sender addresses or provider message IDs in successful logs', async () => {
    class MessageModel {
      constructor(payload) {
        Object.assign(this, payload, { _id: 'mongo-id' });
      }

      async save() {
        return this;
      }
    }
    MessageModel.findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const FilterModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    };
    const embeddingApiService = {
      embed: jest.fn(),
      embedHighQuality: jest.fn(),
    };
    const service = new MessageInboxService(MessageModel, FilterModel, embeddingApiService);

    await service.saveIncomingMessage({
      id: 'provider-message-id-123',
      from: 'Private.Person@Example.COM',
      subject: 'Private subject',
      text: 'Private body',
      date: '2026-08-08T00:00:00.000Z',
    });

    expect(logger.notice).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('Inbox message saved', {
      category: 'message_inbox',
      metadata: {
        senderDomain: 'example.com',
        retentionDays: 90,
        hasEmbedding: false,
        hasHighQualityEmbedding: false,
      },
    });
    const serializedLog = JSON.stringify(logger.debug.mock.calls);
    expect(serializedLog).not.toContain('provider-message-id-123');
    expect(serializedLog).not.toContain('private.person@example.com');
  });
});
