const {
  GLM53_FLASH_UD_IQ4_XS,
  GLM53_FLASH_UD_IQ4_XS_SLUG,
  artifactPreparerProviderPayload,
  artifactServerProviderPayload,
  assertPresetIntegrity,
  buildArtifactPreparerArgs,
  buildArtifactPreparerShell,
  buildArtifactServerShell,
  getModelArtifactPreset,
  modelArtifactPreparationSignal,
} = require('../../services/runpodModelArtifactCatalog');
const { spawnSync } = require('child_process');
const { mkdtempSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

describe('Runpod model artifact catalog', () => {
  test('pins the approved GLM quantization to an exact five-shard manifest', () => {
    const preset = getModelArtifactPreset(GLM53_FLASH_UD_IQ4_XS_SLUG);

    expect(assertPresetIntegrity(preset)).toBe(GLM53_FLASH_UD_IQ4_XS);
    expect(preset).toEqual(expect.objectContaining({
      sourceRepository: 'unsloth/GLM-5.3-Flash-GGUF',
      sourceRevision: '2975ab414d30340466d8c51533c6e91f0cca64c1',
      sourceLastModifiedAt: '2026-08-29T10:43:43.000Z',
      variant: 'UD-IQ4_XS',
      runtimeRepository: 'unslothai/llama.cpp',
      runtimeRevision: '949f7efb097eb20ef36fecdb1afaebff9a4ae7ed',
      totalBytes: 156_822_111_075,
      recommendedVolumeGb: 250,
      recommendedVramGb: 192,
    }));
    expect(preset.manifest).toHaveLength(5);
    expect(preset.manifest.reduce((total, file) => total + file.sizeBytes, 0))
      .toBe(preset.totalBytes);
    expect(getModelArtifactPreset('../arbitrary')).toBeNull();
  });

  test('builds a no-port private template with a bounded kill guard and no credentials', () => {
    const payload = artifactPreparerProviderPayload();
    const args = JSON.parse(payload.args);
    const decodedCommand = args.cmd[0];
    const encoded = decodedCommand.match(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64/u)?.[1];
    const shell = Buffer.from(encoded, 'base64').toString('utf8');

    expect(payload).toEqual(expect.objectContaining({
      name: 'lentmiien-glm53-artifact-preparer-v2',
      image: 'runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404',
      ports: [],
      public: false,
      serverless: false,
      startSsh: false,
      startJupyter: false,
    }));
    expect(decodedCommand).toContain('timeout --signal=TERM --kill-after=60s 14400s');
    expect(shell).toBe(buildArtifactPreparerShell());
    expect(shell).toContain("hf\" download 'unsloth/GLM-5.3-Flash-GGUF'");
    expect(shell).toContain("'2975ab414d30340466d8c51533c6e91f0cca64c1'");
    expect(shell).toContain('sha256sum -c MANIFEST.sha256');
    expect(shell).toContain('RUNPOD_ARTIFACT_READY');
    expect(shell).toContain('-DGGML_CUDA=ON');
    expect(shell).toContain('-DBUILD_SHARED_LIBS=OFF');
    expect(shell).toContain('RUNPOD_ARTIFACT_INFO runtime=reused');
    expect(shell.split('\n').filter((line) => (
      /^\d\|UD-IQ4_XS\/GLM-5\.3-Flash-UD-IQ4_XS-/u.test(line)
    ))).toHaveLength(5);
    expect(shell).toContain('HF_HUB_DOWNLOAD_TIMEOUT=900');
    expect(shell).toContain('HF_HUB_DISABLE_XET=1');
    expect(shell).toContain('download_transport=http xet=disabled');
    expect(shell).toContain('file_state=reused_exact_size');
    expect(shell).toContain('target_file="$model_dir/$model_file"');
    expect(shell).not.toContain('HF_XET_RECONSTRUCT_WRITE_SEQUENTIALLY');
    expect(shell).toContain("-name '*.incomplete' -delete");
    expect(shell).toContain('cleaned_incomplete_bytes=');
    expect(shell).toContain('rm -rf "$cache_dir"');
    expect(shell).toContain('--max-workers 1');
    expect(shell).toContain('attempt=$((attempt + 1))');
    expect(shell).toContain('code=HF_DOWNLOAD_FAILED');
    expect(shell).toContain('required_available_bytes');
    expect(shell).toContain('code=RUNPOD_ARTIFACT_VOLUME_FULL');
    expect(shell).not.toMatch(/^\+\s+/gmu);
    expect(spawnSync('/bin/bash', ['-n'], { input: shell, encoding: 'utf8' }))
      .toEqual(expect.objectContaining({ status: 0, stderr: '' }));
    expect(shell).not.toMatch(/RUNPOD_API_KEY|HF_TOKEN|CLOUDFLARE|lentmiien_llm_api_key/u);
    expect(() => buildArtifactPreparerArgs(undefined, { timeoutSeconds: 10 }))
      .toThrow(TypeError);
  });

  test('generates a valid ready-marker payload in the Python finalizer', () => {
    const shell = buildArtifactPreparerShell();
    const finalizer = shell.match(/python3 - "\$ready_path\.tmp" <<'PY'\n([\s\S]+?)\nPY\n/u)?.[1];
    const directory = mkdtempSync(join(tmpdir(), 'runpod-ready-marker-'));
    const readyPath = join(directory, 'READY.json.tmp');

    try {
      const result = spawnSync('python3', ['-', readyPath], {
        input: finalizer,
        encoding: 'utf8',
      });
      expect(result).toEqual(expect.objectContaining({ status: 0, stderr: '' }));
      expect(JSON.parse(readFileSync(readyPath, 'utf8'))).toEqual(expect.objectContaining({
        schemaVersion: 1,
        slug: GLM53_FLASH_UD_IQ4_XS_SLUG,
        totalBytes: 156_822_111_075,
        preparedAt: expect.any(String),
      }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('builds a private two-GPU llama.cpp server with layered gateway authentication', () => {
    const payload = artifactServerProviderPayload();
    const args = JSON.parse(payload.args);
    const encoded = args.cmd[0].match(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64/u)?.[1];
    const shell = Buffer.from(encoded, 'base64').toString('utf8');

    expect(payload).toEqual(expect.objectContaining({
      name: 'lentmiien-glm53-llama-cpp-cloudflare-v2',
      ports: [],
      public: false,
      serverless: false,
      disk: 40,
      env: {
        TUNNEL_TOKEN: '{{ RUNPOD_SECRET_lentmiien_cloudflare_tunnel_token }}',
        LLAMA_API_KEY: '{{ RUNPOD_SECRET_lentmiien_llm_api_key }}',
        NVIDIA_TF32_OVERRIDE: '0',
      },
    }));
    expect(shell).toBe(buildArtifactServerShell());
    expect(shell).toContain('--tensor-split \'1,1\'');
    expect(shell).toContain('--n-gpu-layers 999');
    expect(shell).toContain('--flash-attn off');
    expect(shell).toContain('--ctx-size 16384');
    expect(shell).toContain('test -n "${LLAMA_API_KEY:-}"');
    expect(shell).not.toContain('--api-key "$LLAMA_API_KEY"');
    expect(shell).toContain("cloudflared_url='https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-linux-amd64'");
    expect(shell).toContain("cloudflared_sha256='f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e'");
    expect(shell).not.toContain('$CLOUDFLARED_AMD64_URL');
    expect(shell).not.toContain('$CLOUDFLARED_AMD64_SHA256');
    expect(shell).toContain('seq 1 270');
    expect(shell).toContain('RUNPOD_LLM_READY');
    expect(shell).toContain('/workspace/artifacts/glm-5.3-flash-ud-iq4-xs/READY.json');
    expect(shell).not.toContain('RUNPOD_API_KEY');
    expect(spawnSync('/bin/bash', ['-n'], { input: shell, encoding: 'utf8' }))
      .toEqual(expect.objectContaining({ status: 0, stderr: '' }));
  });

  test('recognizes the Xet background-writer failure returned for network-volume writes', () => {
    const signal = modelArtifactPreparationSignal([
      { line: 'RuntimeError: File reconstruction error: Internal Writer Error: Background writer channel closed' },
      { line: 'RUNPOD_ARTIFACT_FAILED code=HF_DOWNLOAD_FAILED stage=downloading_model' },
    ]);

    expect(signal).toEqual({
      status: 'failed',
      stage: 'failed',
      errorCode: 'HF_XET_DOWNLOAD_ERROR',
    });
  });
});
