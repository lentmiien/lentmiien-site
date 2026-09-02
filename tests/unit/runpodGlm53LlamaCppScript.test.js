const {
  activeTunnelPod,
  chooseServingGpu,
  main,
  safeCode,
  servingLogSignal,
  verifyGatewayPreflight,
} = require('../../scripts/test-runpod-glm53-llama-cpp-v2');

function response(status, body = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    body: { cancel: jest.fn().mockResolvedValue() },
    text: jest.fn().mockResolvedValue(body),
  };
}

describe('Runpod GLM llama.cpp standalone check', () => {
  test('detects an existing connector from the provider template relationship', () => {
    expect(activeTunnelPod([{
      id: 'pod-1',
      status: 'RUNNING',
      template: 'template-1',
    }], [{
      id: 'template-1',
      name: 'lentmiien-ollama-cloudflare-v2',
    }])).toEqual(expect.objectContaining({ id: 'pod-1' }));
    expect(activeTunnelPod([{ status: 'EXITED', template: 'template-1' }], [{
      id: 'template-1',
      name: 'lentmiien-ollama-cloudflare-v2',
    }])).toBeNull();
  });

  test('classifies provider capacity rejection without echoing request data', () => {
    expect(safeCode({
      code: 'RUNPOD_HTTP_ERROR',
      providerDetail: 'There are no longer any instances available with the requested specifications.',
    })).toBe('RUNPOD_GLM53_GPU_UNAVAILABLE');
  });

  test('is a dry run unless execute is explicit', async () => {
    const service = {
      listPods: jest.fn(),
      listNetworkVolumes: jest.fn(),
      getGpuTypes: jest.fn(),
    };
    const lines = [];

    await expect(main({
      argv: [],
      env: {},
      service,
      stdout: (line) => lines.push(line),
      stderr: jest.fn(),
    })).resolves.toBe(0);

    expect(lines.join('\n')).toContain('Dry run only');
    expect(lines.join('\n')).toContain('exactly two RTX PRO 6000 GPUs');
    expect(service.listPods).not.toHaveBeenCalled();
  });

  test('prefers the RTX PRO 6000 Server profile for the first run', () => {
    const selected = chooseServingGpu([{
      id: 'server',
      name: 'RTX PRO 6000',
      memory: 96,
      availability: 'HIGH',
      price: { secure: 2.09 },
      maxCount: { secure: 8 },
    }, {
      id: 'workstation',
      name: 'RTX PRO 6000 WK',
      memory: 96,
      availability: 'LOW',
      price: { secure: 1.89 },
      maxCount: { secure: 8 },
    }], 'EU-RO-1');

    expect(selected.id).toBe('server');
    expect(chooseServingGpu([{
      id: 'undersized',
      name: 'RTX PRO 6000',
      memory: 96,
      price: { secure: 2.09 },
      maxCount: { secure: 1 },
    }], 'EU-RO-1')).toBeNull();
  });

  test('requires Access to block anonymous traffic and accept the service token', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(403))
      .mockResolvedValueOnce(response(530));

    await expect(verifyGatewayPreflight(
      fetchImpl,
      new URL('https://llm.example.test'),
      {
        RUNPOD_CLOUDFLARE_ACCESS_CLIENT_ID: 'id',
        RUNPOD_CLOUDFLARE_ACCESS_CLIENT_SECRET: 'secret',
        RUNPOD_LLM_API_KEY: 'native-key',
      }
    )).resolves.toEqual({ anonymousStatus: 403, authenticatedStatus: 530 });

    expect(fetchImpl.mock.calls[1][1].headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer native-key',
      'CF-Access-Client-Id': 'id',
    }));
  });

  test('extracts bounded readiness and failure markers from Pod logs', () => {
    expect(servingLogSignal([
      { line: 'RUNPOD_LLM_STAGE stage=loading_model model_bytes=156822111075' },
      { line: 'RUNPOD_LLM_READY slug=glm-5-3-flash-ud-iq4-xs' },
    ])).toEqual({ status: 'ready', stage: 'serving', code: null });
    expect(servingLogSignal([
      { line: 'RUNPOD_LLM_FAILED code=LLAMA_CPP_EXITED stage=loading_model' },
    ])).toEqual({
      status: 'failed',
      stage: 'loading_model',
      code: 'LLAMA_CPP_EXITED',
    });
  });
});
