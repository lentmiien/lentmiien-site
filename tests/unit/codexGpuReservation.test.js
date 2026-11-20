const CodexGpuReservation = require('../../services/codexGpuReservation');

describe('CodexGpuReservation', () => {
  test.each([
    ['ollama', 21600],
    ['vllm', 1800],
  ])('reserves and releases %s with its provider timeout', async (provider, timeout) => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: {
          active: true,
          id: 'reservation-1',
          service: provider,
          idle_timeout_sec: timeout,
        },
      }),
      post: jest.fn().mockResolvedValue({
        data: {
          reservation: {
            active: true,
            id: 'reservation-1',
            service: provider,
            idle_timeout_sec: timeout,
          },
        },
      }),
      delete: jest.fn().mockResolvedValue({
        data: { reservation: { active: false, service: null } },
      }),
    };
    const reservation = new CodexGpuReservation({
      provider,
      httpClient,
      baseUrl: 'http://gateway.test/',
      adminToken: 'admin-token',
      idleTimeoutSec: 60,
      requestTimeoutMs: 12345,
    });

    const reserved = await reservation.reserve();

    expect(reserved).toEqual(expect.objectContaining({
      active: true,
      service: provider,
      idleTimeoutSec: timeout,
    }));
    expect(httpClient.post).toHaveBeenCalledWith(
      'http://gateway.test/gpu/reservation',
      {
        container_id: provider,
        idle_timeout_sec: timeout,
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
      service: provider,
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
    const reservation = new CodexGpuReservation({
      httpClient: {
        post: jest.fn().mockResolvedValue({ data: { reservation: { active: false } } }),
      },
      baseUrl: 'http://gateway.test',
    });

    await expect(reservation.reserve()).rejects.toThrow(
      'The AI Gateway did not confirm an active GPU reservation for ollama.',
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
    const reservation = new CodexGpuReservation({
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
    const reservation = new CodexGpuReservation({
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
