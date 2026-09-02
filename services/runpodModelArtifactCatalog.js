'use strict';

const ARTIFACT_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const GLM53_FLASH_UD_IQ4_XS_SLUG = 'glm-5-3-flash-ud-iq4-xs';
const GLM53_FLASH_UD_IQ4_XS = Object.freeze({
  slug: GLM53_FLASH_UD_IQ4_XS_SLUG,
  name: 'GLM-5.3-Flash · UD-IQ4_XS',
  sourceKind: 'huggingface',
  sourceRepository: 'unsloth/GLM-5.3-Flash-GGUF',
  sourceRevision: '2975ab414d30340466d8c51533c6e91f0cca64c1',
  sourceLastModifiedAt: '2026-08-29T10:43:43.000Z',
  variant: 'UD-IQ4_XS',
  runtimeKind: 'llama_cpp',
  runtimeRepository: 'unslothai/llama.cpp',
  runtimeRevision: '949f7efb097eb20ef36fecdb1afaebff9a4ae7ed',
  runtimeBranch: 'glm5next/upstream',
  runtimeImage: 'runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404',
  huggingFaceHubVersion: '1.29.0',
  relativeRootPath: 'artifacts/glm-5.3-flash-ud-iq4-xs',
  relativeModelPath: 'artifacts/glm-5.3-flash-ud-iq4-xs/model',
  relativeRuntimePath: 'artifacts/glm-5.3-flash-ud-iq4-xs/runtime',
  relativeReadyPath: 'artifacts/glm-5.3-flash-ud-iq4-xs/READY.json',
  totalBytes: 156_822_111_075,
  recommendedVolumeGb: 250,
  recommendedVramGb: 192,
  defaultContextTokens: 16_384,
  preparationDiskGb: 40,
  preparationMaxHourlyCostUsd: 0.99,
  preparationTimeoutSeconds: 4 * 60 * 60,
  manifest: Object.freeze([
    Object.freeze({
      path: 'UD-IQ4_XS/GLM-5.3-Flash-UD-IQ4_XS-00001-of-00005.gguf',
      sizeBytes: 9_429_859,
      sha256: 'eec97673e9acb38f8682250e778f88991e731771bab8d3c0b787985949aacefa',
    }),
    Object.freeze({
      path: 'UD-IQ4_XS/GLM-5.3-Flash-UD-IQ4_XS-00002-of-00005.gguf',
      sizeBytes: 49_989_334_176,
      sha256: '7d64cf0395672c4322012841abec502ea7e20518299bb5e3069003f06f9e6de9',
    }),
    Object.freeze({
      path: 'UD-IQ4_XS/GLM-5.3-Flash-UD-IQ4_XS-00003-of-00005.gguf',
      sizeBytes: 49_607_025_280,
      sha256: '7c2c63c9c30f8060428fdf2ac935dbf2ee9ad8f771d62b6ae47a7f7f2c1520e7',
    }),
    Object.freeze({
      path: 'UD-IQ4_XS/GLM-5.3-Flash-UD-IQ4_XS-00004-of-00005.gguf',
      sizeBytes: 49_486_530_144,
      sha256: '06c90f191871317c92dd9d25a353b687aed44c50f3ac6c713e9fe410bc2d26dd',
    }),
    Object.freeze({
      path: 'UD-IQ4_XS/GLM-5.3-Flash-UD-IQ4_XS-00005-of-00005.gguf',
      sizeBytes: 7_729_791_616,
      sha256: '66ebf9ec85e04d3f44af674ae4f694acbc89cc53db75e42f2f4d3646bf321c0d',
    }),
  ]),
});

const MODEL_ARTIFACT_PRESETS = Object.freeze({
  [GLM53_FLASH_UD_IQ4_XS_SLUG]: GLM53_FLASH_UD_IQ4_XS,
});

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function getModelArtifactPreset(slug) {
  const normalized = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  return MODEL_ARTIFACT_PRESETS[normalized] || null;
}

function modelArtifactDiagnosticCode(lines = []) {
  const diagnosticText = lines.join('\n').slice(-256 * 1024);
  if (/no space left on device|disk quota exceeded|\berrno (?:28|122)\b/iu.test(diagnosticText)) {
    return 'RUNPOD_ARTIFACT_VOLUME_FULL';
  }
  if (/\b(?:401|403)\b|unauthorized|forbidden/iu.test(diagnosticText)) {
    return 'HF_DOWNLOAD_AUTHORIZATION_FAILED';
  }
  if (/\b429\b|too many requests|rate limit/iu.test(diagnosticText)) {
    return 'HF_DOWNLOAD_RATE_LIMITED';
  }
  if (/timed? out|timeoutexception|timeout error/iu.test(diagnosticText)) {
    return 'HF_DOWNLOAD_TIMEOUT';
  }
  if (/cas service error|xet[^\n]{0,80}(?:error|failed)|file reconstruction error|background writer channel closed/iu.test(diagnosticText)) {
    return 'HF_XET_DOWNLOAD_ERROR';
  }
  if (/temporary failure in name resolution|name or service not known|network is unreachable|connecterror/iu.test(diagnosticText)) {
    return 'HF_DOWNLOAD_NETWORK_ERROR';
  }
  return null;
}

function modelArtifactPreparationSignal(logEvents = []) {
  const lines = (Array.isArray(logEvents) ? logEvents : [])
    .slice(0, 5000)
    .map((event) => String(event?.line || '').slice(0, 16 * 1024));
  if (lines.some((line) => line.includes('RUNPOD_ARTIFACT_READY'))) {
    return { status: 'ready', stage: 'ready', errorCode: null };
  }
  const failed = lines.find((line) => line.includes('RUNPOD_ARTIFACT_FAILED'));
  if (failed) {
    const markerCode = failed.match(/\bcode=([A-Z0-9_]{1,80})\b/u)?.[1]
      || 'RUNPOD_ARTIFACT_PREPARATION_FAILED';
    const diagnosticCode = ['HF_DOWNLOAD_FAILED', 'PREPARATION_COMMAND_FAILED'].includes(markerCode)
      ? modelArtifactDiagnosticCode(lines)
      : null;
    return {
      status: 'failed',
      stage: 'failed',
      errorCode: diagnosticCode || markerCode,
    };
  }
  const stages = lines.filter((line) => line.includes('RUNPOD_ARTIFACT_STAGE'));
  const stage = stages.at(-1)?.match(/\bstage=([a-z_]{1,40})\b/u)?.[1] || 'provisioning';
  return { status: 'preparing', stage, errorCode: null };
}

function assertPresetIntegrity(preset) {
  if (!preset || getModelArtifactPreset(preset.slug) !== preset) {
    throw new TypeError('Unknown Runpod model-artifact preset.');
  }
  const paths = [
    preset.relativeRootPath,
    preset.relativeModelPath,
    preset.relativeRuntimePath,
    preset.relativeReadyPath,
    ...preset.manifest.map((file) => file.path),
  ];
  if (paths.some((entry) => !ARTIFACT_PATH_PATTERN.test(entry))) {
    throw new TypeError('Runpod model-artifact preset contains an invalid relative path.');
  }
  if (preset.manifest.some((file) => (
    !Number.isSafeInteger(file.sizeBytes)
    || file.sizeBytes < 1
    || !SHA256_PATTERN.test(file.sha256)
  ))) {
    throw new TypeError('Runpod model-artifact preset contains an invalid manifest entry.');
  }
  const manifestBytes = preset.manifest.reduce((total, file) => total + file.sizeBytes, 0);
  if (manifestBytes !== preset.totalBytes) {
    throw new TypeError('Runpod model-artifact preset byte total does not match its manifest.');
  }
  return preset;
}

function buildArtifactPreparerShell(slug = GLM53_FLASH_UD_IQ4_XS_SLUG) {
  const preset = assertPresetIntegrity(getModelArtifactPreset(slug));
  const root = `/workspace/${preset.relativeRootPath}`;
  const modelDir = `/workspace/${preset.relativeModelPath}`;
  const runtimeDir = `/workspace/${preset.relativeRuntimePath}`;
  const readyPath = `/workspace/${preset.relativeReadyPath}`;
  const manifestLines = preset.manifest.map((file) => (
    `${file.sha256}  model/${file.path}`
  )).join('\n');
  const sizeChecks = preset.manifest.map((file) => (
    `test \"$(stat -c '%s' \"$model_dir/${file.path}\")\" = ${file.sizeBytes}`
  )).join('\n');
  const downloadFileLines = preset.manifest.map((file, index) => (
    `${index + 1}|${file.path}|${file.sizeBytes}`
  )).join('\n');
  const readyPayload = JSON.stringify({
    schemaVersion: 1,
    slug: preset.slug,
    source: {
      repository: preset.sourceRepository,
      revision: preset.sourceRevision,
      variant: preset.variant,
    },
    runtime: {
      kind: preset.runtimeKind,
      repository: preset.runtimeRepository,
      revision: preset.runtimeRevision,
      executable: 'runtime/llama-server',
    },
    modelEntryPoint: `model/${preset.manifest[0].path}`,
    totalBytes: preset.totalBytes,
    manifest: preset.manifest,
  });
  const readyPayloadBase64 = Buffer.from(readyPayload, 'utf8').toString('base64');

  return `#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

artifact_root=${shellQuote(root)}
model_dir=${shellQuote(modelDir)}
runtime_dir=${shellQuote(runtimeDir)}
ready_path=${shellQuote(readyPath)}
work_dir=/tmp/runpod-glm53-preparer
hf_venv=/tmp/runpod-hf-cli
cache_dir=\"$artifact_root/.hf-cache\"
current_stage=provisioning

report_failure() {
  exit_code=$?
  trap - ERR
  case \"$current_stage\" in
    installing) error_code=DEPENDENCY_INSTALL_FAILED ;;
    building_runtime) error_code=RUNTIME_BUILD_FAILED ;;
    downloading_model) error_code=HF_DOWNLOAD_FAILED ;;
    verifying_model) error_code=ARTIFACT_VERIFICATION_FAILED ;;
    finalizing) error_code=ARTIFACT_FINALIZATION_FAILED ;;
    *) error_code=PREPARATION_COMMAND_FAILED ;;
  esac
  printf 'RUNPOD_ARTIFACT_FAILED code=%s stage=%s exit=%s\\n' \\
    \"$error_code\" \"$current_stage\" \"$exit_code\"
  exit \"$exit_code\"
}
trap report_failure ERR

case \"$artifact_root\" in
  /workspace/artifacts/*) ;;
  *) printf 'RUNPOD_ARTIFACT_FAILED code=INVALID_ARTIFACT_ROOT\\n'; exit 64 ;;
esac

mkdir -p \"$artifact_root\" \"$model_dir\" \"$runtime_dir\" \"$cache_dir\"
exec 9>\"$artifact_root/.prepare.lock\"
if ! flock -n 9; then
  printf 'RUNPOD_ARTIFACT_FAILED code=PREPARATION_ALREADY_RUNNING\\n'
  exit 73
fi
stale_partial_bytes=0
download_cache_dir=\"$model_dir/.cache/huggingface/download\"
if [ -d \"$download_cache_dir\" ]; then
  stale_partial_bytes=$(find \"$download_cache_dir\" -type f -name '*.incomplete' -printf '%s\\n' \\
    | awk '{total += $1} END {printf \"%.0f\", total + 0}')
  find \"$download_cache_dir\" -type f -name '*.incomplete' -delete
fi
xet_cache_bytes=$(du -sB1 \"$cache_dir\" | awk '{print $1}')
rm -rf \"$cache_dir\"
mkdir -p \"$cache_dir\"
sync
printf 'RUNPOD_ARTIFACT_INFO cleaned_incomplete_bytes=%s cleaned_xet_cache_bytes=%s\\n' \\
  \"$stale_partial_bytes\" \"$xet_cache_bytes\"
existing_model_bytes=$(du -sb \"$model_dir\" | awk '{print $1}')
available_bytes=$(df -PB1 \"$artifact_root\" | awk 'NR == 2 {print $4}')
case \"$existing_model_bytes:$available_bytes\" in
  ''|*[!0-9:]*)
    printf 'RUNPOD_ARTIFACT_FAILED code=ARTIFACT_CAPACITY_CHECK_FAILED\\n'
    exit 74
    ;;
esac
if [ \"$existing_model_bytes\" -gt ${preset.totalBytes} ]; then
  existing_model_bytes=${preset.totalBytes}
fi
required_available_bytes=$((${preset.totalBytes} - existing_model_bytes + 10000000000))
printf 'RUNPOD_ARTIFACT_INFO existing_model_bytes=%s available_bytes=%s required_available_bytes=%s\\n' \\
  \"$existing_model_bytes\" \"$available_bytes\" \"$required_available_bytes\"
if [ \"$available_bytes\" -lt \"$required_available_bytes\" ]; then
  printf 'RUNPOD_ARTIFACT_FAILED code=RUNPOD_ARTIFACT_VOLUME_FULL\\n'
  exit 72
fi
rm -f \"$ready_path\" \"$ready_path.tmp\"

current_stage=installing
printf 'RUNPOD_ARTIFACT_STAGE stage=installing\\n'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \\
  build-essential ca-certificates cmake git ninja-build python3 python3-venv >/dev/null
rm -rf /var/lib/apt/lists/*
python3 -m venv \"$hf_venv\"
\"$hf_venv/bin/pip\" install --disable-pip-version-check --no-cache-dir \\
  ${shellQuote(`huggingface_hub[hf_xet]==${preset.huggingFaceHubVersion}`)} >/dev/null

current_stage=building_runtime
printf 'RUNPOD_ARTIFACT_STAGE stage=building_runtime\\n'
if [ -x \"$runtime_dir/llama-server\" ] \\
  && [ \"$(cat \"$runtime_dir/REVISION\" 2>/dev/null || true)\" = ${shellQuote(preset.runtimeRevision)} ] \\
  && NVIDIA_TF32_OVERRIDE=0 \"$runtime_dir/llama-server\" --version >/dev/null 2>&1; then
  printf 'RUNPOD_ARTIFACT_INFO runtime=reused revision=${preset.runtimeRevision}\\n'
else
  rm -rf \"$work_dir\"
  mkdir -p \"$work_dir/source\"
  git -C \"$work_dir/source\" init -q
  git -C \"$work_dir/source\" remote add origin ${shellQuote(`https://github.com/${preset.runtimeRepository}.git`)}
  git -C \"$work_dir/source\" fetch -q --depth 1 origin ${shellQuote(preset.runtimeRevision)}
  git -C \"$work_dir/source\" checkout -q --detach FETCH_HEAD
  test \"$(git -C \"$work_dir/source\" rev-parse HEAD)\" = ${shellQuote(preset.runtimeRevision)}
  cmake -S \"$work_dir/source\" -B \"$work_dir/build\" -G Ninja \\
    -DCMAKE_BUILD_TYPE=Release \\
    -DCMAKE_CUDA_ARCHITECTURES='80;86;89;90;100;120' \\
    -DBUILD_SHARED_LIBS=OFF \\
    -DGGML_CUDA=ON \\
    -DGGML_NATIVE=OFF \\
    -DLLAMA_CURL=OFF >/dev/null
  build_jobs=$(nproc)
  if [ \"$build_jobs\" -gt 16 ]; then build_jobs=16; fi
  cmake --build \"$work_dir/build\" --target llama-server --parallel \"$build_jobs\"
  install -m 0555 \"$work_dir/build/bin/llama-server\" \"$runtime_dir/llama-server.tmp\"
  mv -f \"$runtime_dir/llama-server.tmp\" \"$runtime_dir/llama-server\"
  printf '%s\\n' ${shellQuote(preset.runtimeRevision)} > \"$runtime_dir/REVISION\"
  NVIDIA_TF32_OVERRIDE=0 \"$runtime_dir/llama-server\" --version >/dev/null
fi

current_stage=downloading_model
printf 'RUNPOD_ARTIFACT_STAGE stage=downloading_model total_bytes=${preset.totalBytes}\\n'
export HF_HOME=\"$cache_dir\"
export HF_HUB_DISABLE_TELEMETRY=1
export HF_HUB_DISABLE_UPDATE_CHECK=1
export HF_HUB_DISABLE_XET=1
export HF_HUB_DOWNLOAD_TIMEOUT=900
export HF_HUB_ETAG_TIMEOUT=120
export NO_COLOR=1
printf 'RUNPOD_ARTIFACT_INFO download_transport=http xet=disabled\\n'
while IFS='|' read -r shard_number model_file expected_size; do
  test -n \"$model_file\"
  test -n \"$expected_size\"
  target_file=\"$model_dir/$model_file\"
  if [ -f \"$target_file\" ] && [ \"$(stat -c '%s' \"$target_file\")\" = \"$expected_size\" ]; then
    printf 'RUNPOD_ARTIFACT_INFO shard=%s file_state=reused_exact_size bytes=%s\\n' \\
      \"$shard_number\" \"$expected_size\"
    continue
  fi
  rm -f \"$target_file\"
  attempt=1
  while :; do
    printf 'RUNPOD_ARTIFACT_STAGE stage=downloading_model shard=%s shards=${preset.manifest.length} attempt=%s\\n' \\
      \"$shard_number\" \"$attempt\"
    if \"$hf_venv/bin/hf\" download ${shellQuote(preset.sourceRepository)} \"$model_file\" \\
      --revision ${shellQuote(preset.sourceRevision)} \\
      --local-dir \"$model_dir\" \\
      --max-workers 1 \\
      && [ \"$(stat -c '%s' \"$target_file\")\" = \"$expected_size\" ]; then
      break
    fi
    if [ \"$attempt\" -ge 4 ]; then
      printf 'RUNPOD_ARTIFACT_FAILED code=HF_DOWNLOAD_FAILED stage=downloading_model shard=%s attempts=%s\\n' \\
        \"$shard_number\" \"$attempt\"
      exit 75
    fi
    printf 'RUNPOD_ARTIFACT_RETRY stage=downloading_model shard=%s attempt=%s\\n' \\
      \"$shard_number\" \"$attempt\"
    sleep \"$((attempt * 15))\"
    attempt=$((attempt + 1))
  done
done <<'RUNPOD_DOWNLOAD_FILES'
${downloadFileLines}
RUNPOD_DOWNLOAD_FILES

current_stage=verifying_model
printf 'RUNPOD_ARTIFACT_STAGE stage=verifying_model total_bytes=${preset.totalBytes}\\n'
${sizeChecks}
test \"$(find \"$model_dir/${preset.variant}\" -maxdepth 1 -type f -name '*.gguf' | wc -l)\" = ${preset.manifest.length}
cat > \"$artifact_root/MANIFEST.sha256.tmp\" <<'RUNPOD_MANIFEST'
${manifestLines}
RUNPOD_MANIFEST
mv -f \"$artifact_root/MANIFEST.sha256.tmp\" \"$artifact_root/MANIFEST.sha256\"
(cd \"$artifact_root\" && sha256sum -c MANIFEST.sha256)

current_stage=finalizing
printf 'RUNPOD_ARTIFACT_STAGE stage=finalizing\\n'
rm -rf \"$model_dir/.cache\" \"$cache_dir\" \"$work_dir\" \"$hf_venv\"
python3 - \"$ready_path.tmp\" <<'PY'
import base64
import json
import os
import sys
from datetime import datetime, timezone

payload = json.loads(base64.b64decode('${readyPayloadBase64}', validate=True).decode('utf-8'))
payload['preparedAt'] = datetime.now(timezone.utc).isoformat()
with open(sys.argv[1], 'w', encoding='utf-8') as handle:
    json.dump(payload, handle, separators=(',', ':'), sort_keys=True)
    handle.write('\\n')
    handle.flush()
    os.fsync(handle.fileno())
PY
mv -f \"$ready_path.tmp\" \"$ready_path\"
sync
printf 'RUNPOD_ARTIFACT_READY slug=${preset.slug} total_bytes=${preset.totalBytes}\\n'
while :; do sleep 300; done
`;
}

function buildArtifactPreparerArgs(slug = GLM53_FLASH_UD_IQ4_XS_SLUG, {
  timeoutSeconds,
} = {}) {
  const preset = assertPresetIntegrity(getModelArtifactPreset(slug));
  const requestedTimeout = Number(timeoutSeconds ?? preset.preparationTimeoutSeconds);
  if (!Number.isSafeInteger(requestedTimeout) || requestedTimeout < 900 || requestedTimeout > 86_400) {
    throw new TypeError('Artifact preparation timeout must be between 900 and 86400 seconds.');
  }
  const encodedScript = Buffer.from(buildArtifactPreparerShell(slug), 'utf8').toString('base64');
  const command = [
    'set -Eeuo pipefail',
    `printf '%s' ${shellQuote(encodedScript)} | base64 -d > /tmp/runpod-artifact-preparer.sh`,
    'chmod 0700 /tmp/runpod-artifact-preparer.sh',
    `exec timeout --signal=TERM --kill-after=60s ${requestedTimeout}s /bin/bash /tmp/runpod-artifact-preparer.sh`,
  ].join('; ');
  return JSON.stringify({
    entrypoint: ['/bin/bash', '-lc'],
    cmd: [command],
  });
}

function artifactPreparerTemplate(slug = GLM53_FLASH_UD_IQ4_XS_SLUG) {
  const preset = assertPresetIntegrity(getModelArtifactPreset(slug));
  return {
    name: 'GLM-5.3 Artifact Preparer',
    providerTemplateName: 'lentmiien-glm53-artifact-preparer-v2',
    image: preset.runtimeImage,
    args: buildArtifactPreparerArgs(slug),
    diskGb: preset.preparationDiskGb,
    ports: [],
    env: {
      HF_HUB_DISABLE_TELEMETRY: '1',
    },
    persistentDiskGb: 10,
    persistentPath: '/workspace',
  };
}

function artifactPreparerProviderPayload(slug = GLM53_FLASH_UD_IQ4_XS_SLUG) {
  const template = artifactPreparerTemplate(slug);
  return {
    name: template.providerTemplateName,
    image: template.image,
    args: template.args,
    category: 'NVIDIA',
    disk: template.diskGb,
    ports: template.ports,
    env: template.env,
    mounts: {
      persistent: {
        size: template.persistentDiskGb,
        path: template.persistentPath,
      },
    },
    serverless: false,
    public: false,
    startSsh: false,
    startJupyter: false,
  };
}

module.exports = {
  ARTIFACT_PATH_PATTERN,
  GLM53_FLASH_UD_IQ4_XS,
  GLM53_FLASH_UD_IQ4_XS_SLUG,
  MODEL_ARTIFACT_PRESETS,
  SHA256_PATTERN,
  artifactPreparerProviderPayload,
  artifactPreparerTemplate,
  assertPresetIntegrity,
  buildArtifactPreparerArgs,
  buildArtifactPreparerShell,
  getModelArtifactPreset,
  modelArtifactDiagnosticCode,
  modelArtifactPreparationSignal,
  shellQuote,
};
