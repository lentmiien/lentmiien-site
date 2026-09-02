const {
  DEFAULT_SECRET_NAME,
  RUNPOD_GRAPHQL_URL,
  RunpodSecretBootstrapError,
  ensureRunpodSecret,
  requiredSecretName,
} = require('../../scripts/bootstrap-runpod-cloudflare-secret');

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

describe('Runpod Cloudflare Secret bootstrap', () => {
  test('uses a fixed GraphQL origin and leaves an existing encrypted Secret unchanged', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      data: {
        myself: {
          secrets: [{ id: 'secret-1', name: DEFAULT_SECRET_NAME, description: null }],
        },
      },
    }));

    await expect(ensureRunpodSecret({
      apiKey: 'runpod-key',
      value: 'cloudflare-token',
      fetchImpl,
    })).resolves.toEqual({
      created: false,
      exists: true,
      id: 'secret-1',
      name: DEFAULT_SECRET_NAME,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      RUNPOD_GRAPHQL_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer runpod-key' }),
        redirect: 'error',
      })
    );
    expect(fetchImpl.mock.calls[0][1].body).not.toContain('cloudflare-token');
  });

  test('creates a missing Secret with a GraphQL variable and returns metadata only', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { myself: { secrets: [] } } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          secretCreate: {
            id: 'secret-2',
            name: DEFAULT_SECRET_NAME,
            description: 'Cloudflare Tunnel token',
          },
        },
      }));

    const result = await ensureRunpodSecret({
      apiKey: 'runpod-key',
      value: 'cloudflare-token',
      description: 'Cloudflare Tunnel token',
      fetchImpl,
    });

    expect(result).toEqual({
      created: true,
      exists: true,
      id: 'secret-2',
      name: DEFAULT_SECRET_NAME,
    });
    const createPayload = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(createPayload.query).toContain('SecretCreateInput!');
    expect(createPayload.query).not.toContain('cloudflare-token');
    expect(createPayload.variables).toEqual({
      input: {
        name: DEFAULT_SECRET_NAME,
        value: 'cloudflare-token',
        description: 'Cloudflare Tunnel token',
      },
    });
    expect(result).not.toHaveProperty('value');
  });

  test('rejects invalid configuration before sending a provider mutation', async () => {
    const fetchImpl = jest.fn();
    expect(() => requiredSecretName('../bad')).toThrow(RunpodSecretBootstrapError);
    await expect(ensureRunpodSecret({
      apiKey: 'runpod-key',
      value: '',
      fetchImpl,
    })).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_TUNNEL_TOKEN_NOT_CONFIGURED',
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('does not expose provider error details that could echo submitted variables', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { myself: { secrets: [] } } }))
      .mockResolvedValueOnce(jsonResponse({
        errors: [{ message: 'Rejected cloudflare-token' }],
      }));

    await expect(ensureRunpodSecret({
      apiKey: 'runpod-key',
      value: 'cloudflare-token',
      fetchImpl,
    })).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_SECRET_PROVIDER_ERROR',
      message: 'Runpod rejected the Secret metadata operation.',
    }));
  });
});
