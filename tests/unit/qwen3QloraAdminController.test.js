const mockGateway = {
  gatewayBaseUrl: 'http://gateway.test:8080',
  gatewayErrorMessage: jest.fn((error, fallback) => error.message || fallback),
  getDashboardState: jest.fn(),
  downloadModel: jest.fn(),
  unloadModel: jest.fn(),
  uploadDataset: jest.fn(),
  deleteDataset: jest.fn(),
  createTrainingJob: jest.fn(),
  getTrainingJob: jest.fn(),
  generate: jest.fn(),
  compareGenerations: jest.fn(),
  getGpuReservation: jest.fn(),
  reserveGpu: jest.fn(),
  releaseGpuReservation: jest.fn(),
};

const mockTrainingDataService = {
  listGroupsWithStats: jest.fn(),
  buildCsvForGroup: jest.fn(),
  buildDatasetFileForGroup: jest.fn(),
};

jest.mock('../../services/qwen3QloraGatewayService', () => {
  const GatewayService = jest.fn(() => mockGateway);
  GatewayService.SERVICE_PREFIX = '/qwen3-qlora';
  GatewayService.RESERVATION_SERVICE_ID = 'qwen3_qlora';
  return GatewayService;
});
jest.mock('../../services/trainingDataService', () => jest.fn(() => mockTrainingDataService));
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const controller = require('../../controllers/qwen3QloraAdminController');

function createRequest(overrides = {}) {
  return {
    method: 'POST',
    originalUrl: '/admin/qwen3-qlora/test',
    body: {},
    params: {},
    user: { name: 'admin' },
    ip: '127.0.0.1',
    ...overrides,
  };
}

function createResponse() {
  const res = {
    headersSent: false,
    json: jest.fn(),
    render: jest.fn(),
    send: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn(),
    type: jest.fn(),
    set: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.type.mockReturnValue(res);
  res.set.mockReturnValue(res);
  res.render.mockImplementation((view, locals, callback) => {
    if (callback) callback(null, '<html>QLoRA</html>');
  });
  return res;
}

async function invoke(handler, req, res) {
  handler(req, res, jest.fn());
  await new Promise((resolve) => setImmediate(resolve));
}

describe('Qwen3 QLoRA admin controller', () => {
  test('renders the shared dashboard with the QLoRA service profile', async () => {
    mockTrainingDataService.listGroupsWithStats.mockResolvedValue([{ groupId: 'support' }]);
    const req = createRequest({ method: 'GET', originalUrl: '/admin/qwen3-qlora' });
    const res = createResponse();

    await invoke(controller.render, req, res);

    expect(mockTrainingDataService.listGroupsWithStats).toHaveBeenCalledWith({ includeInactive: false });
    expect(res.render).toHaveBeenCalledWith(
      'admin_qwen3_lora',
      expect.objectContaining({
        servicePrefix: '/qwen3-qlora',
        adminBase: '/admin/qwen3-qlora',
        supportsContainerActions: false,
        supportsThinking: true,
        supportsGpuReservation: true,
        reservationContainerId: 'qwen3_qlora',
        maxUploadMb: 200,
        defaultTrainingParams: expect.objectContaining({
          gradient_accumulation_steps: 16,
          max_seq_length: 512,
        }),
      }),
      expect.any(Function),
    );
    expect(res.send).toHaveBeenCalledWith('<html>QLoRA</html>');
  });

  test('forwards normalized conservative training parameters to the QLoRA gateway', async () => {
    mockGateway.createTrainingJob.mockResolvedValue({ job_id: 'job-1', status: 'queued' });
    const req = createRequest({
      originalUrl: '/admin/qwen3-qlora/train/jobs',
      body: {
        dataset_id: ' dataset-1 ',
        adapter_name: ' adapter-v1 ',
        params: {
          gradient_accumulation_steps: '16',
          max_seq_length: '512',
          target_modules: ['q_proj', 'v_proj'],
        },
      },
    });
    const res = createResponse();

    await invoke(controller.createTrainingJob, req, res);

    expect(mockGateway.createTrainingJob).toHaveBeenCalledWith({
      dataset_id: 'dataset-1',
      adapter_name: 'adapter-v1',
      overwrite_adapter: false,
      params: {
        gradient_accumulation_steps: 16,
        max_seq_length: 512,
        target_modules: ['q_proj', 'v_proj'],
      },
    });
    expect(res.json).toHaveBeenCalledWith({ job_id: 'job-1', status: 'queued' });
  });

  test('forwards thinking and sampling controls to generation', async () => {
    mockGateway.generate.mockResolvedValue({ content: 'Answer', reasoning_content: 'Reasoning' });
    const req = createRequest({
      originalUrl: '/admin/qwen3-qlora/generate',
      body: {
        prompt: 'Think about this',
        adapter_name: 'adapter-v1',
        temperature: '0.7',
        do_sample: true,
        enable_thinking: true,
      },
    });
    const res = createResponse();

    await invoke(controller.generate, req, res);

    expect(mockGateway.generate).toHaveBeenCalledWith({
      prompt: 'Think about this',
      adapter_name: 'adapter-v1',
      temperature: 0.7,
      do_sample: true,
      enable_thinking: true,
    });
    expect(res.json).toHaveBeenCalledWith({ content: 'Answer', reasoning_content: 'Reasoning' });
  });

  test('reserves QLoRA with a bounded idle timeout', async () => {
    mockGateway.reserveGpu.mockResolvedValue({ active: true, service: 'qwen3_qlora' });
    const req = createRequest({
      originalUrl: '/admin/qwen3-qlora/reservation',
      body: { idle_timeout_sec: '1800' },
    });
    const res = createResponse();

    await invoke(controller.reserveGpu, req, res);

    expect(mockGateway.reserveGpu).toHaveBeenCalledWith({ idleTimeoutSec: 1800 });
    expect(res.json).toHaveBeenCalledWith({
      reservation: { active: true, service: 'qwen3_qlora' },
    });
  });

  test('rejects thinking mode with greedy decoding before calling the gateway', async () => {
    const req = createRequest({
      originalUrl: '/admin/qwen3-qlora/generate',
      body: {
        prompt: 'Think about this',
        do_sample: false,
        enable_thinking: true,
      },
    });
    const res = createResponse();

    await invoke(controller.generate, req, res);

    expect(mockGateway.generate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Thinking mode requires sampling. Enable sampling or disable thinking.',
    }));
  });
});
