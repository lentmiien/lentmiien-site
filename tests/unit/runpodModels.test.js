const RunpodOperationEvent = require('../../models/runpod_operation_event');
const RunpodBillingPeriod = require('../../models/runpod_billing_period');
const RunpodPod = require('../../models/runpod_pod');
const RunpodPodBillingPeriod = require('../../models/runpod_pod_billing_period');
const RunpodNetworkVolume = require('../../models/runpod_network_volume');
const RunpodModelArtifact = require('../../models/runpod_model_artifact');
const RunpodWorkloadTemplate = require('../../models/runpod_workload_template');

describe('Runpod persistence models', () => {
  test('uses dedicated template, Pod lifecycle, and audit collections', () => {
    expect(RunpodWorkloadTemplate.collection.collectionName).toBe('runpod_workload_templates');
    expect(RunpodPod.collection.collectionName).toBe('runpod_pods');
    expect(RunpodOperationEvent.collection.collectionName).toBe('runpod_operation_events');
    expect(RunpodBillingPeriod.collection.collectionName).toBe('runpod_billing_periods');
    expect(RunpodPodBillingPeriod.collection.collectionName).toBe('runpod_pod_billing_periods');
    expect(RunpodNetworkVolume.collection.collectionName).toBe('runpod_network_volumes');
    expect(RunpodModelArtifact.collection.collectionName).toBe('runpod_model_artifacts');
  });

  test('pins large external model artifacts without storing credentials or absolute paths', () => {
    expect(RunpodModelArtifact.schema.path('sourceKind').options.enum).toEqual(['huggingface']);
    expect(RunpodModelArtifact.schema.path('runtimeKind').options.enum).toEqual(['llama_cpp']);
    expect(RunpodModelArtifact.schema.path('sourceRevision')).toBeDefined();
    expect(RunpodModelArtifact.schema.path('runtimeRevision')).toBeDefined();
    expect(RunpodModelArtifact.schema.path('manifest')).toBeDefined();
    expect(RunpodModelArtifact.schema.path('totalBytes')).toBeDefined();
    expect(RunpodModelArtifact.schema.path('preparationStatus').options.enum).toEqual([
      'planned', 'preparing', 'ready', 'failed', 'archived',
    ]);
    expect(RunpodModelArtifact.schema.path('preparationStage').options.enum).toContain('downloading_model');
    expect(RunpodModelArtifact.schema.path('preparationPodRecordId')).toBeDefined();
    expect(RunpodModelArtifact.schema.path('providerPreparationPodId')).toBeDefined();
    expect(RunpodModelArtifact.schema.path('apiKey')).toBeUndefined();
    expect(RunpodModelArtifact.schema.path('downloadUrl')).toBeUndefined();
  });

  test('validates bounded, volume-relative artifact manifests', async () => {
    const base = {
      slug: 'glm-5-3-flash-ud-iq4-xs',
      name: 'GLM-5.3-Flash · UD-IQ4_XS',
      sourceRepository: 'unsloth/GLM-5.3-Flash-GGUF',
      sourceRevision: '2975ab414d30340466d8c51533c6e91f0cca64c1',
      variant: 'UD-IQ4_XS',
      runtimeKind: 'llama_cpp',
      runtimeRepository: 'unslothai/llama.cpp',
      runtimeRevision: '949f7efb097eb20ef36fecdb1afaebff9a4ae7ed',
      networkVolumeRecordId: '507f191e810c19729de860ea',
      providerNetworkVolumeId: 'provider-volume-id',
      dataCenterId: 'EU-RO-1',
      relativeModelPath: 'models/glm-5.3-flash/UD-IQ4_XS/model-00001-of-00005.gguf',
      relativeRuntimePath: 'runtime/llama.cpp/949f7ef/llama-server',
      manifest: [{
        path: 'UD-IQ4_XS/model-00001-of-00005.gguf',
        sizeBytes: 9429859,
        sha256: 'eec97673e9acb38f8682250e778f88991e731771bab8d3c0b787985949aacefa',
      }],
      totalBytes: 156822111075,
      recommendedVolumeGb: 250,
      recommendedVramGb: 192,
      defaultContextTokens: 16384,
    };

    await expect(new RunpodModelArtifact(base).validate()).resolves.toBeUndefined();
    const unsafe = new RunpodModelArtifact({
      ...base,
      relativeModelPath: '/workspace/secrets/model.gguf',
      manifest: Array.from({ length: 33 }, (_, index) => ({
        path: `shards/model-${index}.gguf`,
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      })),
    });
    await expect(unsafe.validate()).rejects.toEqual(expect.objectContaining({
      errors: expect.objectContaining({
        relativeModelPath: expect.anything(),
        manifest: expect.anything(),
      }),
    }));
  });

  test('tracks active and archived provider network volumes without credentials', () => {
    expect(RunpodNetworkVolume.schema.path('providerNetworkVolumeId')).toBeDefined();
    expect(RunpodNetworkVolume.schema.path('volumeType').options.enum).toEqual([
      'STANDARD', 'HIGH_PERFORMANCE', 'UNKNOWN',
    ]);
    expect(RunpodNetworkVolume.schema.path('lifecycleGroup').options.enum).toEqual([
      'active', 'archived',
    ]);
    expect(RunpodNetworkVolume.schema.path('estimatedMonthlyCostUsd')).toBeDefined();
    expect(RunpodNetworkVolume.schema.path('cachedModels')).toBeDefined();
    expect(RunpodNetworkVolume.schema.path('modelsUpdatedAt')).toBeDefined();
    expect(RunpodNetworkVolume.schema.path('apiKey')).toBeUndefined();
    expect(RunpodPod.schema.path('providerNetworkVolumeId')).toBeDefined();
    expect(RunpodPod.schema.path('networkVolumeRecordId')).toBeDefined();
  });

  test('stores reusable setup metadata without API credentials', () => {
    expect(RunpodWorkloadTemplate.schema.path('setupKind').options.enum).toEqual([
      'ollama_pull', 'ollama_download', 'hf_gguf_prepare', 'llama_cpp_serve',
    ]);
    expect(RunpodWorkloadTemplate.schema.path('providerTemplateId')).toBeDefined();
    expect(RunpodWorkloadTemplate.schema.path('persistentPath')).toBeDefined();
    expect(RunpodWorkloadTemplate.schema.path('defaultModel')).toBeDefined();
    expect(RunpodWorkloadTemplate.schema.path('accessMode').options.enum)
      .toContain('private_none');
    expect(RunpodWorkloadTemplate.schema.path('apiKey')).toBeUndefined();
  });

  test('accepts the private artifact verifier profile used by provider synchronization', async () => {
    const template = new RunpodWorkloadTemplate({
      slug: 'glm53-artifact-preparer',
      name: 'GLM artifact verifier',
      providerTemplateName: 'lentmiien-glm53-artifact-preparer-v2',
      image: 'runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404',
      diskGb: 40,
      persistentDiskGb: 10,
      persistentPath: '/workspace',
      ports: [],
      env: {},
      setupKind: 'hf_gguf_prepare',
      defaultModel: 'glm-5-3-flash-ud-iq4-xs',
      servicePort: 1,
      healthPath: '/',
      accessMode: 'private_none',
    });

    await expect(template.validate()).resolves.toBeUndefined();
  });

  test('models running, stopped, and archived state with bounded cost controls', () => {
    expect(RunpodPod.schema.path('lifecycleGroup').options.enum).toEqual([
      'running', 'stopped', 'archived',
    ]);
    expect(RunpodPod.schema.path('autoStopAt')).toBeDefined();
    expect(RunpodPod.schema.path('autoStopClaimedAt')).toBeDefined();
    expect(RunpodPod.schema.path('lastOperationError')).toBeDefined();
    expect(RunpodPod.schema.path('maxHourlyCostAcknowledged')).toBeDefined();
    expect(RunpodPod.schema.path('setupStatus').options.enum).toContain('ready');
    expect(RunpodPod.schema.path('podPurpose').options.enum).toEqual([
      'ollama_service', 'llama_cpp_service', 'model_download', 'model_artifact_prepare',
    ]);
    expect(RunpodPod.schema.path('modelArtifactRecordId')).toBeDefined();
    expect(RunpodPod.schema.path('contextTokens')).toBeDefined();
    expect(RunpodPod.schema.path('cleanupStatus').options.enum).toEqual([
      'not_required', 'pending', 'completed', 'failed',
    ]);
    expect(RunpodPod.schema.path('usageState').options.enum).toEqual([
      'running', 'stopped', 'archived', 'unknown',
    ]);
    expect(RunpodPod.schema.path('runningMs')).toBeDefined();
    expect(RunpodPod.schema.path('stoppedMs')).toBeDefined();
    expect(RunpodPod.schema.path('billingTotalUsd')).toBeDefined();
    expect(RunpodPod.schema.path('apiKey')).toBeUndefined();
  });

  test('retains a bounded operation audit taxonomy', () => {
    expect(RunpodOperationEvent.schema.path('action').options.enum).toEqual(expect.arrayContaining([
      'create', 'setup', 'start', 'stop', 'extend', 'delete', 'auto_stop', 'template_sync',
      'billing_sync',
      'artifact_prepare',
    ]));
    expect(RunpodOperationEvent.schema.path('outcome').options.enum).toEqual([
      'requested', 'succeeded', 'failed',
    ]);
  });
});
