const axios = require('axios');

const {
  buildAiGatewayReservationRequest,
  normalizeAiGatewayReservation,
} = require('../utils/aiGatewayReservation');

const DEFAULT_AI_GATEWAY_BASE_URL = 'http://192.168.0.20:8080';
const RESERVATION_PATH = '/gpu/reservation';
const MINIMUM_IDLE_TIMEOUT_SEC = 6 * 60 * 60;
const DEFAULT_REQUEST_TIMEOUT_MS = 630000;

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || DEFAULT_AI_GATEWAY_BASE_URL).trim();
  return (baseUrl || DEFAULT_AI_GATEWAY_BASE_URL).replace(/\/+$/, '');
}

function getCodexOllamaReservationConfig(overrides = {}) {
  const configuredIdleTimeout = positiveInteger(
    overrides.idleTimeoutSec ?? process.env.CODEX_OLLAMA_RESERVATION_SECONDS,
    MINIMUM_IDLE_TIMEOUT_SEC,
  );

  return {
    baseUrl: normalizeBaseUrl(overrides.baseUrl ?? process.env.AI_GATEWAY_BASE_URL),
    containerId: String(
      overrides.containerId ?? process.env.CODEX_OLLAMA_RESERVATION_CONTAINER ?? 'ollama',
    ).trim() || 'ollama',
    idleTimeoutSec: Math.max(MINIMUM_IDLE_TIMEOUT_SEC, configuredIdleTimeout),
    requestTimeoutMs: positiveInteger(
      overrides.requestTimeoutMs ?? process.env.CODEX_OLLAMA_RESERVATION_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    adminToken: String(overrides.adminToken ?? process.env.LLM_ADMIN_TOKEN ?? '').trim(),
  };
}

class CodexOllamaReservation {
  constructor(options = {}) {
    this.httpClient = options.httpClient || axios;
    this.configOverrides = options;
    this.held = false;
    this.reservation = null;
    this.reservePromise = null;
    this.releasePromise = null;
  }

  getConfig() {
    return getCodexOllamaReservationConfig(this.configOverrides);
  }

  getStatus() {
    const config = this.getConfig();
    return {
      held: this.held,
      service: this.reservation?.service || config.containerId,
      reservationId: this.reservation?.id || '',
      idleTimeoutSec: config.idleTimeoutSec,
    };
  }

  buildHeaders() {
    const { adminToken } = this.getConfig();
    return adminToken ? { 'X-Admin-Token': adminToken } : {};
  }

  async reserve() {
    if (this.reservePromise) {
      return this.reservePromise;
    }
    this.reservePromise = this.ensureReserved().finally(() => {
      this.reservePromise = null;
    });
    return this.reservePromise;
  }

  async ensureReserved() {
    if (!this.held) {
      return this.reserveNow();
    }

    const config = this.getConfig();
    const response = await this.httpClient.get(
      `${config.baseUrl}${RESERVATION_PATH}`,
      { timeout: config.requestTimeoutMs },
    );
    const reservation = normalizeAiGatewayReservation(response.data);
    if (reservation?.active === true) {
      if (reservation.service && reservation.service !== config.containerId) {
        throw new Error(`The AI Gateway reservation changed to ${reservation.service}.`);
      }
      this.reservation = reservation;
      return reservation;
    }

    this.held = false;
    this.reservation = reservation;
    return this.reserveNow();
  }

  async reserveNow() {
    const config = this.getConfig();
    const body = buildAiGatewayReservationRequest({
      container_id: config.containerId,
      idle_timeout_sec: config.idleTimeoutSec,
      wait: true,
    });
    const response = await this.httpClient.post(
      `${config.baseUrl}${RESERVATION_PATH}`,
      body,
      {
        timeout: config.requestTimeoutMs,
        headers: this.buildHeaders(),
      },
    );
    const reservation = normalizeAiGatewayReservation(response.data);
    if (!reservation || reservation.active !== true) {
      throw new Error('The AI Gateway did not confirm an active Ollama GPU reservation.');
    }
    if (reservation.service && reservation.service !== config.containerId) {
      throw new Error(`The AI Gateway reserved ${reservation.service} instead of ${config.containerId}.`);
    }
    this.held = true;
    this.reservation = reservation;
    return reservation;
  }

  async release() {
    if (!this.held) {
      return { released: false, reservation: this.reservation };
    }
    if (this.releasePromise) {
      return this.releasePromise;
    }
    this.releasePromise = this.releaseNow().finally(() => {
      this.releasePromise = null;
    });
    return this.releasePromise;
  }

  async releaseNow() {
    const config = this.getConfig();
    const response = await this.httpClient.delete(
      `${config.baseUrl}${RESERVATION_PATH}`,
      {
        timeout: config.requestTimeoutMs,
        headers: this.buildHeaders(),
      },
    );
    const reservation = normalizeAiGatewayReservation(response.data);
    if (reservation && reservation.active === true) {
      throw new Error('The AI Gateway still reports an active GPU reservation after release.');
    }
    this.held = false;
    this.reservation = reservation;
    return { released: true, reservation };
  }
}

module.exports = CodexOllamaReservation;
module.exports.DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;
module.exports.MINIMUM_IDLE_TIMEOUT_SEC = MINIMUM_IDLE_TIMEOUT_SEC;
module.exports.getCodexOllamaReservationConfig = getCodexOllamaReservationConfig;
