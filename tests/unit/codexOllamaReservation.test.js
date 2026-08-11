const CodexOllamaReservation = require('../../services/codexOllamaReservation');

describe('CodexOllamaReservation', () => {
  test('reserves Ollama with a minimum six-hour window and releases it', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: {
          active: true,
          id: 'reservation-1',
          service: 'ollama',
          idle_timeout_sec: 21600,
        },
      }),
      post: jest.fn().mockResolvedValue({
        data: {
          reservation: {
            active: true,
            id: 'reservation-1',
            service: 'ollama',
            idle_timeout_sec: 21600,
          },
        },
      }),
      delete: jest.fn().mockResolvedValue({
        data: { reservation: { active: false, service: null } },
      }),
    };
    const reservation = new CodexOllamaReservation({
      httpClient,
      baseUrl: 'http://gateway.test/',
      adminToken: 'admin-token',
      idleTimeoutSec: 60,
      requestTimeoutMs: 12345,
    });

    const reserved = await reservation.reserve();

    expect(reserved).toEqual(expect.objectContaining({
      active: true,
      service: 'ollama',
      idleTimeoutSec: 21600,
    }));
    expect(httpClient.post).toHaveBeenCalledWith(
      'http://gateway.test/gpu/reservation',
      {
        container_id: 'ollama',
        idle_timeout_sec: 21600,
        wait: true,
      },
      {
        timeout: 12345,
        headers: { 'X-Admin-Token': 'admin-token' },
      },
    );
    expect(reservation.getStatus().held).toBe(true);

    await expect(reservation.reserve()).resolves.toEqual(expect.objectContaining({
      active: true,
      service: 'ollama',
    }));
    expect(httpClient.get).toHaveBeenCalledWith(
      'http://gateway.test/gpu/reservation',
      { timeout: 12345 },
    );
    expect(httpClient.post).toHaveBeenCalledTimes(1);

    await expect(reservation.release()).resolves.toEqual(expect.objectContaining({ released: true }));
    expect(httpClient.delete).toHaveBeenCalledWith(
      'http://gateway.test/gpu/reservation',
      {
        timeout: 12345,
        headers: { 'X-Admin-Token': 'admin-token' },
      },
    );
    expect(reservation.getStatus().held).toBe(false);

    await expect(reservation.release()).resolves.toEqual(expect.objectContaining({ released: false }));
    expect(httpClient.delete).toHaveBeenCalledTimes(1);
  });

  test('does not mark an unconfirmed Gateway reservation as held', async () => {
    const reservation = new CodexOllamaReservation({
      httpClient: {
        post: jest.fn().mockResolvedValue({ data: { reservation: { active: false } } }),
      },
      baseUrl: 'http://gateway.test',
    });

    await expect(reservation.reserve()).rejects.toThrow(
      'The AI Gateway did not confirm an active Ollama GPU reservation.',
    );
    expect(reservation.getStatus().held).toBe(false);
  });

  test('creates a new reservation when a held lease has expired between turns', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({ data: { active: false } }),
      post: jest.fn().mockResolvedValue({
        data: { reservation: { active: true, service: 'ollama' } },
      }),
    };
    const reservation = new CodexOllamaReservation({
      httpClient,
      baseUrl: 'http://gateway.test',
    });

    await reservation.reserve();
    await reservation.reserve();

    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(httpClient.post).toHaveBeenCalledTimes(2);
    expect(reservation.getStatus().held).toBe(true);
  });

  test('marks only the caller that initiated a coalesced release', async () => {
    let finishRelease;
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { reservation: { active: true, service: 'ollama' } },
      }),
      delete: jest.fn().mockReturnValue(new Promise((resolve) => {
        finishRelease = resolve;
      })),
    };
    const reservation = new CodexOllamaReservation({
      httpClient,
      baseUrl: 'http://gateway.test',
    });
    await reservation.reserve();

    const initiatedRelease = reservation.release();
    const coalescedRelease = reservation.release();
    finishRelease({ data: { reservation: { active: false, service: null } } });

    await expect(initiatedRelease).resolves.toEqual(expect.objectContaining({
      released: true,
      initiated: true,
    }));
    await expect(coalescedRelease).resolves.toEqual(expect.objectContaining({
      released: true,
      initiated: false,
    }));
    expect(httpClient.delete).toHaveBeenCalledTimes(1);
  });
});
