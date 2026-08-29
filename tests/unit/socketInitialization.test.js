const mockIo = {
  on: jest.fn(),
  use: jest.fn(),
};
const mockCancelExpiry = jest.fn();
const mockScheduleSessionExpiry = jest.fn();
const mockRegisterChat5Handlers = jest.fn();
const mockRegisterChat5_5Handlers = jest.fn();
const mockRegisterChat5_6Handlers = jest.fn();

jest.mock('socket.io', () => jest.fn(() => mockIo));
jest.mock('../../database', () => ({
  RoleModel: {},
  UseraccountModel: {},
}));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
}));
jest.mock('../../utils/socketAuthorization', () => ({
  authorizeSocketSession: jest.fn(),
}));
jest.mock('../../utils/sessionExpiry', () => ({
  scheduleSessionExpiry: mockScheduleSessionExpiry,
}));
jest.mock('../../socket_io/chat5/chat5handler', () => mockRegisterChat5Handlers);
jest.mock('../../socket_io/chat5_5/chat5_5handler', () => mockRegisterChat5_5Handlers);
jest.mock('../../socket_io/chat5_6/chat5_6handler', () => mockRegisterChat5_6Handlers);

const initializeSocketIO = require('../../socket_io');

describe('Socket.IO connection initialization', () => {
  let connectionHandler;

  beforeEach(() => {
    connectionHandler = null;
    mockIo.on.mockImplementation((eventName, handler) => {
      if (eventName === 'connection') {
        connectionHandler = handler;
      }
    });
    mockScheduleSessionExpiry.mockReturnValue(mockCancelExpiry);
  });

  function createSocket(overrides = {}) {
    const socket = {
      connected: true,
      data: {
        canUseChat5: true,
        sessionExpiresAt: Date.now() + 60_000,
        userName: 'alice',
      },
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      ...overrides,
    };
    socket.disconnect.mockImplementation(() => {
      socket.connected = false;
    });
    return socket;
  }

  test('stops initialization when scheduling detects an already-expired session', async () => {
    mockScheduleSessionExpiry.mockImplementation((_expiresAt, onExpire) => {
      onExpire();
      return mockCancelExpiry;
    });
    initializeSocketIO({}, jest.fn());
    const socket = createSocket();

    await connectionHandler(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(mockCancelExpiry).toHaveBeenCalledTimes(1);
    expect(socket.join).not.toHaveBeenCalled();
    expect(mockRegisterChat5Handlers).not.toHaveBeenCalled();
    expect(mockRegisterChat5_5Handlers).not.toHaveBeenCalled();
    expect(mockRegisterChat5_6Handlers).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  test('continues normal initialization while the session remains connected', async () => {
    initializeSocketIO({}, jest.fn());
    const socket = createSocket();

    await connectionHandler(socket);

    expect(socket.join).toHaveBeenCalledWith('user:alice');
    expect(mockRegisterChat5Handlers).toHaveBeenCalledWith({
      io: mockIo,
      socket,
      userName: 'alice',
    });
    expect(mockRegisterChat5_5Handlers).toHaveBeenCalledTimes(1);
    expect(mockRegisterChat5_6Handlers).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('welcome');
  });
});
