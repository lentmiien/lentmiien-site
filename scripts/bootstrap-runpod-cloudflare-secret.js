#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });

const RUNPOD_GRAPHQL_URL = 'https://api.runpod.io/graphql';
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

async function readJsonResponse(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > RESPONSE_LIMIT_BYTES) {
    throw new RunpodSecretBootstrapError(
      'Runpod returned too much data.',
      'RUNPOD_SECRET_RESPONSE_TOO_LARGE'
    );
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new RunpodSecretBootstrapError(
      'Runpod returned invalid JSON.',
      'RUNPOD_SECRET_INVALID_RESPONSE'
    );
  }
}

async function graphqlRequest({
  apiKey,
  query,
  variables = {},
  fetchImpl = global.fetch,
  timeoutMs = 15_000,
}) {
  if (!apiKey || typeof fetchImpl !== 'function') {
    throw new RunpodSecretBootstrapError(
      'Runpod authentication is not configured.',
      'RUNPOD_NOT_CONFIGURED'
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(RUNPOD_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      redirect: 'error',
      signal: controller.signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length)) {
      throw new RunpodSecretBootstrapError(
        'Runpod rejected the Secret metadata operation.',
        'RUNPOD_SECRET_PROVIDER_ERROR'
      );
    }
    return payload.data || {};
  } catch (error) {
    if (error instanceof RunpodSecretBootstrapError) throw error;
    if (error?.name === 'AbortError') {
      throw new RunpodSecretBootstrapError(
        'Runpod Secret metadata request timed out.',
        'RUNPOD_SECRET_TIMEOUT'
      );
    }
    throw new RunpodSecretBootstrapError(
      'Runpod Secret metadata could not be reached.',
      'RUNPOD_SECRET_NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }
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
  const metadata = await graphqlRequest({
    apiKey,
    fetchImpl,
    query: 'query RunpodSecretMetadata { myself { secrets { id name description } } }',
  });
  const secrets = Array.isArray(metadata?.myself?.secrets)
    ? metadata.myself.secrets.slice(0, 500)
    : [];
  const existing = secrets.find((secret) => secret?.name === normalizedName);
  if (existing || checkOnly) {
    return {
      created: false,
      exists: Boolean(existing),
      id: existing?.id || null,
      name: normalizedName,
    };
  }
  const created = await graphqlRequest({
    apiKey,
    fetchImpl,
    query: 'mutation CreateRunpodSecret($input: SecretCreateInput!) { secretCreate(input: $input) { id name description } }',
    variables: {
      input: {
        name: normalizedName,
        value: secretValue,
        description: String(description || '').slice(0, 500),
      },
    },
  });
  if (!created?.secretCreate?.id || created.secretCreate.name !== normalizedName) {
    throw new RunpodSecretBootstrapError(
      'Runpod did not confirm Secret creation.',
      'RUNPOD_SECRET_INVALID_RESPONSE'
    );
  }
  return {
    created: true,
    exists: true,
    id: created.secretCreate.id,
    name: normalizedName,
  };
}

async function main({ stdout = console.log, stderr = console.error } = {}) {
  try {
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
  RUNPOD_GRAPHQL_URL,
  RunpodSecretBootstrapError,
  ensureRunpodSecret,
  graphqlRequest,
  main,
  requiredSecretName,
};
