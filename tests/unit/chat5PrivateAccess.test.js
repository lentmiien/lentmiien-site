jest.mock('../../models/useraccount', () => ({ findById: jest.fn() }));
jest.mock('../../models/role', () => ({ findOne: jest.fn() }));
jest.mock('../../models/conversation5', () => ({ exists: jest.fn() }));
jest.mock('../../models/conversation4', () => ({ exists: jest.fn() }));
const User = require('../../models/useraccount');
const Role = require('../../models/role');
const Conversation = require('../../models/conversation5');
const Legacy = require('../../models/conversation4');
const { page, messagePage, socketGuard } = require('../../middleware/chat5PrivateAccess');
const { verificationReceipt } = require('../../utils/twoFactorSession');
const id = 'a'.repeat(24); const principal = { _id: id, name: 'owner', type_user: 'admin', hash_password: 'synthetic', two_factor: { enabled: true, version: 'synthetic' } };
describe('Chat5 scoped reads used by durable publication', () => {
  let res;
  beforeEach(() => {
    User.findById.mockReturnValue({ select: () => ({ lean: async () => principal }) });
    Conversation.exists.mockResolvedValue(null); Legacy.exists.mockResolvedValue(null); Role.findOne.mockResolvedValue(null);
    res = { set: jest.fn().mockReturnThis(), sendStatus: jest.fn(), locals: {} };
  });
  test('foreign conversation and direct message reads deny even admins; member succeeds', async () => {
    const next = jest.fn(); await page({ user: principal, params: { id } }, res, next); expect(res.sendStatus).toHaveBeenCalledWith(404); expect(next).not.toHaveBeenCalled();
    await messagePage({ user: principal, params: { id } }, res, next); expect(next).not.toHaveBeenCalled();
    Conversation.exists.mockResolvedValue({ _id: id }); await page({ user: principal, params: { id } }, res, next); expect(next).toHaveBeenCalledTimes(1); expect(res.locals.gtag).toBe(false);
  });
  test.each(['chat5-joinConversation', 'chat5-load-messages', 'chat5_6-fetchConversation', 'fetchConversation'])('%s rejects foreign sources and leaves rooms', async event => {
    const socket = { request: { session: { passport: { user: id }, twoFactor: verificationReceipt(principal), cookie: { expires: new Date(Date.now() + 60000) } } }, data: { userName: 'owner' }, rooms: ['conversation:secret'], leave: jest.fn(), emit: jest.fn() };
    const next = jest.fn(); const ack = jest.fn();
    await socketGuard(socket)([event, /fetchConversation/.test(event) ? id : { conversationId: id }, ack], next);
    expect(next).not.toHaveBeenCalled(); expect(socket.leave).toHaveBeenCalledWith('conversation:secret'); expect(ack).toHaveBeenCalledWith({ ok: false, message: 'Access denied' });
  });
  test('valid membership cannot bypass required factor proof on events or private delivery', async () => {
    const socket = { request: { session: { passport: { user: id }, cookie: { expires: new Date(Date.now() + 60000) } } }, data: { userName: 'owner' }, emit: jest.fn() };
    Conversation.exists.mockResolvedValue({ _id: id });
    const next = jest.fn();
    const { authorized } = require('../../utils/chat5RoomDelivery');
    await socketGuard(socket)(['chat5-joinConversation', { conversationId: id }], next);
    expect(next).not.toHaveBeenCalled(); expect(await authorized(socket, [id])).toBe(false);
    socket.request.session.twoFactor = verificationReceipt(principal);
    await socketGuard(socket)(['chat5-joinConversation', { conversationId: id }], next);
    expect(next).toHaveBeenCalledTimes(1); expect(await authorized(socket, [id])).toBe(true);
    socket.request.session.twoFactor.credential = 'old-password';
    expect(await authorized(socket, [id])).toBe(false);
  });
  test('history revalidates revoked principal and session expiration on each event', async () => {
    const socket = { request: { session: { passport: { user: id }, cookie: { expires: new Date(Date.now() - 1) } } }, data: { userName: 'owner' }, emit: jest.fn() };
    const next = jest.fn(); await socketGuard(socket)(['chat5-history-range', {}], next); expect(next).not.toHaveBeenCalled();
    socket.request.session.cookie.expires = new Date(Date.now() + 60000);
    User.findById.mockReturnValue({ select: () => ({ lean: async () => ({ ...principal, type_user: 'user' }) }) });
    await socketGuard(socket)(['chat5-history-range', {}], next); expect(next).not.toHaveBeenCalled();
  });
});
