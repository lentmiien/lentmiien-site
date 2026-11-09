jest.mock('../../socket_io/chat5_5/chat5_5context', () => ({
  models: {}, services: { conversationService: { postToConversationNew: jest.fn(), generateTitle: jest.fn() } }, helpers: {},
}));
jest.mock('../../services/asrApiService', () => jest.fn());
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/chat5Markdown', () => ({ renderMessageHtml: message => message }));
const { services: { conversationService } } = require('../../socket_io/chat5_5/chat5_5context');
const register = require('../../socket_io/chat5_5/chat5_5handler');
const logger = require('../../utils/logger');
const { ChatInputError } = require('../../utils/chatInputError');

test.each([true, false])('append acknowledges validation=%s and publishes only already saved prompts', async validation => {
  const handlers = {};
  const socket = { on: (name, fn) => { handlers[name] = fn; }, emit: jest.fn() };
  await register({ io: { userRoom: id => id, conversationRoom: id => id }, socket, userName: 'owner', principal: { _id: 'owner' } });
  const error = validation ? new ChatInputError('images_not_allowed', 'Select a vision model.')
    : Object.assign(new Error('PRIVATE provider body'), { savedUserMessages: [{ _id: 'prompt', contentType: 'text' }], conversationId: 'conv' });
  conversationService.postToConversationNew.mockRejectedValue(error);
  const ack = jest.fn();
  await handlers['chat5-append']({ conversation_id: 'conv', prompt: 'New prompt', response: true }, ack);
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false, promptSaved: !validation,
    code: validation ? 'images_not_allowed' : 'chat_append_failed' }));
  if (validation) {
    expect(logger.error).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  } else expect(socket.emit).toHaveBeenCalledWith('chat5-messages', { id: 'conv', messages: [expect.objectContaining({ _id: 'prompt' })] });
  expect(JSON.stringify([ack.mock.calls, logger.error.mock.calls])).not.toContain('PRIVATE');
});

test('saved prompt is acknowledged before optional title generation finishes', async () => {
  const handlers = {};
  const room = { emit: jest.fn() };
  const socket = { on: (name, fn) => { handlers[name] = fn; }, emit: jest.fn(), to: () => room };
  await register({ io: { userRoom: id => id, conversationRoom: id => id, to: () => room }, socket, userName: 'owner', principal: { _id: 'owner' } });
  conversationService.postToConversationNew.mockResolvedValue({ userMessage: { _id: 'saved-prompt', contentType: 'text' } });
  let finishTitle;
  conversationService.generateTitle.mockImplementation(() => new Promise(resolve => { finishTitle = resolve; }));
  const ack = jest.fn();
  const work = handlers['chat5-append']({ conversation_id: 'conv', prompt: 'New prompt', settings: { title: 'NEW' } }, ack);
  await Promise.resolve();
  expect(ack).toHaveBeenCalledWith({ ok: true, promptSaved: true, conversationId: 'conv' });
  finishTitle('Title');
  await work;
  expect(ack).toHaveBeenCalledTimes(1);
});
