const { scheduleSessionExpiry } = require('../../utils/sessionExpiry');

describe('scheduleSessionExpiry', () => {
  test('uses bounded timer chunks before expiring a long session', () => {
    let now = 0;
    const callbacks = [];
    const delays = [];
    const onExpire = jest.fn();
    const setTimer = jest.fn((callback, delay) => {
      callbacks.push(callback);
      delays.push(delay);
      return { unref: jest.fn() };
    });

    scheduleSessionExpiry(25, onExpire, {
      maxDelayMs: 10,
      now: () => now,
      setTimer,
      clearTimer: jest.fn(),
    });

    expect(delays).toEqual([10]);
    now = 10;
    callbacks.shift()();
    expect(delays).toEqual([10, 10]);
    now = 20;
    callbacks.shift()();
    expect(delays).toEqual([10, 10, 5]);
    now = 25;
    callbacks.shift()();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('cancels the current timer and prevents later chunks', () => {
    const callback = jest.fn();
    const timer = { unref: jest.fn() };
    const clearTimer = jest.fn();
    const setTimer = jest.fn(() => timer);
    const cancel = scheduleSessionExpiry(20, jest.fn(), {
      maxDelayMs: 10,
      now: () => 0,
      setTimer,
      clearTimer,
    });

    callback.mockImplementation(setTimer.mock.calls[0][0]);
    cancel();
    callback();

    expect(clearTimer).toHaveBeenCalledWith(timer);
    expect(setTimer).toHaveBeenCalledTimes(1);
  });
});
