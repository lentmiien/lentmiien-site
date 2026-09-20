jest.mock('../../utils/chat5Markdown', () => ({ renderMessageHtml: message => message }));
const { emitConversationMessages } = require('../../utils/chat5Realtime');

test('completion removes an expired call already loaded by a connected client', () => {
  const room = { emit: jest.fn() };
  const io = { conversationRoom: id => `conversation:${id}`, userRoom: id => `user:${id}`, to: jest.fn(() => room) };
  emitConversationMessages(io, { conversation: { _id: 'conversation-1', members: [] },
    removedIds: ['expired-call'], messages: [], placeholderId: 'placeholder-1' });
  expect(io.to).toHaveBeenCalledWith('conversation:conversation-1');
  expect(room.emit).toHaveBeenCalledWith('chat5-messages-removed', {
    conversationId: 'conversation-1', removedIds: ['expired-call'],
  });
  expect(room.emit).toHaveBeenCalledWith('chat5-messages', {
    id: 'conversation-1', messages: [], placeholderId: 'placeholder-1',
  });
});
