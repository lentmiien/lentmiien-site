const Qwen3LoraGatewayService = require('./qwen3LoraGatewayService');
const {
  buildGatewayErrorMessage: buildSharedGatewayErrorMessage,
  DEFAULT_GATEWAY_BASE_URL,
} = require('./qwen3LoraGatewayService');

const SERVICE_PREFIX = '/qwen3-qlora';
const RESERVATION_SERVICE_ID = 'qwen3_qlora';
const DEFAULT_INFO_TIMEOUT_MS = readPositiveInteger(process.env.QWEN3_QLORA_INFO_TIMEOUT_MS, 10000);
const DEFAULT_ACTION_TIMEOUT_MS = readPositiveInteger(
  process.env.QWEN3_QLORA_ACTION_TIMEOUT_MS,
  20 * 60 * 1000,
);
const DEFAULT_UPLOAD_TIMEOUT_MS = readPositiveInteger(
  process.env.QWEN3_QLORA_UPLOAD_TIMEOUT_MS,
  20 * 60 * 1000,
);
const DEFAULT_DOWNLOAD_TIMEOUT_MS = readPositiveInteger(
  process.env.QWEN3_QLORA_DOWNLOAD_TIMEOUT_MS,
  75 * 60 * 1000,
);
const DEFAULT_GENERATE_TIMEOUT_MS = readPositiveInteger(
  process.env.QWEN3_QLORA_GENERATE_TIMEOUT_MS,
  12 * 60 * 60 * 1000 + 10 * 60 * 1000,
);

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildGatewayErrorMessage(error, fallback = 'Qwen3 QLoRA request failed.') {
  return buildSharedGatewayErrorMessage(error, fallback, DEFAULT_GATEWAY_BASE_URL);
}

class Qwen3QloraGatewayService extends Qwen3LoraGatewayService {
  constructor({
    gatewayBaseUrl = DEFAULT_GATEWAY_BASE_URL,
    infoTimeoutMs = DEFAULT_INFO_TIMEOUT_MS,
    actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS,
    uploadTimeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
    downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
    generateTimeoutMs = DEFAULT_GENERATE_TIMEOUT_MS,
    adminToken = process.env.LLM_ADMIN_TOKEN || '',
  } = {}) {
    super({
      gatewayBaseUrl,
      infoTimeoutMs,
      actionTimeoutMs,
      uploadTimeoutMs,
      downloadTimeoutMs,
      generateTimeoutMs,
      servicePrefix: SERVICE_PREFIX,
      serviceLabel: 'Qwen3 QLoRA',
      logCategory: 'qwen3_qlora_gateway',
      functionPrefix: 'qwen3_qlora',
      dashboardContainerPath: '',
      apiDebugFileName: 'services/qwen3QloraGatewayService.js',
    });
    this.adminToken = typeof adminToken === 'string' ? adminToken.trim() : '';
  }

  reservationHeaders() {
    return this.adminToken ? { 'X-Admin-Token': this.adminToken } : {};
  }

  async getGpuReservation() {
    return this.request({
      method: 'get',
      path: '/gpu/reservation',
      timeout: this.infoTimeoutMs,
      functionName: 'qwen3_qlora_gpu_reservation_get',
    });
  }

  async reserveGpu({ idleTimeoutSec = 900 } = {}) {
    return this.request({
      method: 'post',
      path: '/gpu/reservation',
      data: {
        container_id: RESERVATION_SERVICE_ID,
        wait: true,
        idle_timeout_sec: idleTimeoutSec,
      },
      headers: this.reservationHeaders(),
      timeout: this.actionTimeoutMs,
      functionName: 'qwen3_qlora_gpu_reservation_create',
    });
  }

  async releaseGpuReservation() {
    const current = await this.getGpuReservation();
    const activeReservation = current?.reservation && typeof current.reservation === 'object'
      ? current.reservation
      : current;
    if (activeReservation?.active !== true) {
      return current;
    }

    const reservedService = String(activeReservation.service || '').replace(/-/g, '_');
    if (reservedService !== RESERVATION_SERVICE_ID) {
      const error = new Error(
        `The active GPU reservation belongs to ${activeReservation.service || 'another service'}.`,
      );
      error.statusCode = 409;
      throw error;
    }

    return this.request({
      method: 'delete',
      path: '/gpu/reservation',
      headers: this.reservationHeaders(),
      timeout: this.actionTimeoutMs,
      functionName: 'qwen3_qlora_gpu_reservation_release',
    });
  }
}

module.exports = Qwen3QloraGatewayService;
module.exports.buildGatewayErrorMessage = buildGatewayErrorMessage;
module.exports.DEFAULT_ACTION_TIMEOUT_MS = DEFAULT_ACTION_TIMEOUT_MS;
module.exports.DEFAULT_DOWNLOAD_TIMEOUT_MS = DEFAULT_DOWNLOAD_TIMEOUT_MS;
module.exports.DEFAULT_GATEWAY_BASE_URL = DEFAULT_GATEWAY_BASE_URL;
module.exports.DEFAULT_GENERATE_TIMEOUT_MS = DEFAULT_GENERATE_TIMEOUT_MS;
module.exports.DEFAULT_INFO_TIMEOUT_MS = DEFAULT_INFO_TIMEOUT_MS;
module.exports.DEFAULT_UPLOAD_TIMEOUT_MS = DEFAULT_UPLOAD_TIMEOUT_MS;
module.exports.RESERVATION_SERVICE_ID = RESERVATION_SERVICE_ID;
module.exports.SERVICE_PREFIX = SERVICE_PREFIX;
