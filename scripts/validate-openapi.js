#!/usr/bin/env node
const path = require('path');
const fs = require('fs/promises');
const SwaggerParser = require('@apidevtools/swagger-parser');

const DEFAULT_SPECS = [
  'core-api.v1.yaml',
  'schedule-task.v1.yaml',
  'chat5-pdf.v1.yaml',
  'chat5-realtime.v1.yaml'
];

const yamlDir = path.join(__dirname, '..', 'public', 'yaml');

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateSpec(filename) {
  const fullPath = path.isAbsolute(filename) ? filename : path.join(yamlDir, filename);
  const exists = await fileExists(fullPath);
  if (!exists) {
    throw new Error(`Spec not found: ${filename}`);
  }

  await SwaggerParser.validate(fullPath, { validate: { schema: true, spec: true } });
  return fullPath;
}

async function main() {
  const cliTargets = process.argv.slice(2);
  const targets = cliTargets.length ? cliTargets : DEFAULT_SPECS;
  const results = [];
  const failures = [];

  for (const spec of targets) {
    process.stdout.write(`Validating ${spec} ... `);
    try {
      const resolved = await validateSpec(spec);
      results.push(resolved);
      process.stdout.write('OK\n');
    } catch (error) {
      failures.push({ spec, error });
      process.stdout.write('FAILED\n');
      console.error(error.message);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} spec(s) failed validation.`);
    process.exitCode = 1;
  } else {
    console.log(`\nValidated ${results.length} spec(s).`);
  }
}

main().catch((error) => {
  console.error('Unexpected OpenAPI validation failure:', error);
  process.exit(1);
});
