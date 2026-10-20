#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });

const { RunpodApiV2Service } = require('../services/runpodApiV2Service');
const DEFAULT_SECRET_NAME = 'lentmiien_cloudflare_tunnel_token';
const SECRET_NAME_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u;
const RESPONSE_LIMIT_BYTES = 64 * 1024;

class RunpodSecretBootstrapError extends Error {
  constructor(message, code = 'RUNPOD_SECRET_BOOTSTRAP_FAILED') {
    super(message);
    this.name = 'RunpodSecretBootstrapError';
    this.code = code;
  }
}

function requiredSecretName(value) {
  const name = String(value || DEFAULT_SECRET_NAME).trim().toLowerCase();
  if (!SECRET_NAME_PATTERN.test(name)) {
    throw new RunpodSecretBootstrapError(
      'The Runpod Secret name is invalid.',
      'RUNPOD_SECRET_NAME_INVALID'
    );
  }
  return name;
}

async function ensureRunpodSecret({
  apiKey,
  value,
  name = DEFAULT_SECRET_NAME,
  description = 'Cloudflare Tunnel token for the Lentmiien Runpod LLM gateway',
  fetchImpl = global.fetch,
  checkOnly = false,
  missingValueCode = 'RUNPOD_TUNNEL_TOKEN_NOT_CONFIGURED',
  missingValueMessage = 'The Cloudflare tunnel token is missing or invalid.',
}) {
  const normalizedName = requiredSecretName(name);
  const secretValue = typeof value === 'string' ? value.trim() : '';
  if (!checkOnly && (!secretValue || secretValue.length > 16 * 1024)) {
    throw new RunpodSecretBootstrapError(
      String(missingValueMessage || 'The Secret value is missing or invalid.').slice(0, 240),
      String(missingValueCode || 'RUNPOD_SECRET_VALUE_NOT_CONFIGURED').slice(0, 80)
    );
  }
  const service = new RunpodApiV2Service({ apiKey, fetchImpl, maxResponseBytes: RESPONSE_LIMIT_BYTES });
  const find = async () => {
    const secrets = await service.listSecrets(normalizedName);
    if (secrets.length > 1 || secrets.some((s) => s.name.toLowerCase() !== normalizedName)) {
      throw new RunpodSecretBootstrapError('Runpod returned invalid Secret metadata.', 'RUNPOD_SECRET_INVALID_RESPONSE');
    }
    return secrets[0] || null;
  };
  try {
    const existing = await find();
    if (existing || checkOnly) {
      return { created: false, exists: Boolean(existing), id: existing?.id || null, name: normalizedName };
    }
    let created;
    try {
      created = await service.createSecret({ name: normalizedName, value: secretValue,
        description: String(description || '').slice(0, 500) });
      if (created?.name !== normalizedName) {
        throw new RunpodSecretBootstrapError('Runpod did not confirm Secret creation.', 'RUNPOD_SECRET_INVALID_RESPONSE');
      }
    } catch (error) {
      // Never replay the write. A race or lost response can have created this exact name.
      if (error.status === 409 || !error.status || error.status >= 500) {
        const recovered = await find();
        if (recovered) return { created: false, exists: true, id: recovered.id, name: normalizedName };
        throw new RunpodSecretBootstrapError('Secret creation is unconfirmed. Use --check before retrying.', 'RUNPOD_SECRET_OUTCOME_UNKNOWN');
      }
      throw error;
    }
    return { created: true, exists: true, id: created.id, name: normalizedName };
  } catch (error) {
    if (error instanceof RunpodSecretBootstrapError) throw error;
    // Provider payloads may echo supplied secret values. Never attach them or a cause.
    throw new RunpodSecretBootstrapError('Runpod Secret metadata operation failed.',
      error.code === 'RUNPOD_INVALID_RESPONSE' || error.code === 'RUNPOD_INCOMPLETE_RESPONSE'
        ? 'RUNPOD_SECRET_INVALID_RESPONSE' : error.code === 'RUNPOD_RESPONSE_TOO_LARGE'
          ? 'RUNPOD_SECRET_RESPONSE_TOO_LARGE' : 'RUNPOD_SECRET_PROVIDER_ERROR');
  }
}

async function main({ stdout = console.log, stderr = console.error } = {}) {
  try {
    if (process.argv.includes('--help')) {
      stdout('Use REST v2 account secrets to create a missing name, or --check for metadata only. Existing names are never overwritten.');
      return null;
    }
    const checkOnly = process.argv.slice(2).includes('--check');
    const result = await ensureRunpodSecret({
      apiKey: process.env.RUNPOD_API_KEY,
      value: process.env.RUNPOD_CLOUDFLARE_TUNNEL_TOKEN,
      name: process.env.RUNPOD_CLOUDFLARE_TUNNEL_SECRET_NAME || DEFAULT_SECRET_NAME,
      checkOnly,
    });
    if (result.created) {
      stdout(`Created encrypted Runpod Secret metadata: ${result.name}`);
    } else if (result.exists) {
      stdout(`Runpod Secret metadata is present; no value was changed: ${result.name}`);
    } else {
      stdout(`Runpod Secret metadata is not present: ${result.name}`);
      process.exitCode = 2;
    }
    return result;
  } catch (error) {
    stderr(`Runpod Cloudflare Secret bootstrap failed: ${error?.code || 'RUNPOD_SECRET_BOOTSTRAP_FAILED'}`);
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_SECRET_NAME,
  RunpodSecretBootstrapError,
  ensureRunpodSecret,
  main,
  requiredSecretName,
};
