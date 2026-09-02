#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });

const {
  ensureRunpodSecret,
} = require('./bootstrap-runpod-cloudflare-secret');

const DEFAULT_LLM_API_SECRET_NAME = 'lentmiien_llm_api_key';

async function main({
  stdout = console.log,
  stderr = console.error,
  env = process.env,
  argv = process.argv.slice(2),
  ensureSecret = ensureRunpodSecret,
} = {}) {
  try {
    const checkOnly = argv.includes('--check');
    const result = await ensureSecret({
      apiKey: env.RUNPOD_API_KEY,
      value: env.RUNPOD_LLM_API_KEY,
      name: env.RUNPOD_LLM_API_SECRET_NAME || DEFAULT_LLM_API_SECRET_NAME,
      description: 'Native llama.cpp API key for the Lentmiien Runpod LLM gateway',
      checkOnly,
      missingValueCode: 'RUNPOD_LLM_API_KEY_NOT_CONFIGURED',
      missingValueMessage: 'The native LLM API key is missing or invalid.',
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
    stderr(`Runpod LLM API Secret bootstrap failed: ${error?.code || 'RUNPOD_SECRET_BOOTSTRAP_FAILED'}`);
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_LLM_API_SECRET_NAME,
  main,
};
