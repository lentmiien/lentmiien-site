const RunpodOperationEvent = require('../../models/runpod_operation_event');
const RunpodBillingPeriod = require('../../models/runpod_billing_period');
const RunpodPod = require('../../models/runpod_pod');
const RunpodPodBillingPeriod = require('../../models/runpod_pod_billing_period');
const RunpodNetworkVolume = require('../../models/runpod_network_volume');
const RunpodWorkloadTemplate = require('../../models/runpod_workload_template');

describe('Runpod persistence models', () => {
  test('uses dedicated template, Pod lifecycle, and audit collections', () => {
    expect(RunpodWorkloadTemplate.collection.collectionName).toBe('runpod_workload_templates');
    expect(RunpodPod.collection.collectionName).toBe('runpod_pods');
    expect(RunpodOperationEvent.collection.collectionName).toBe('runpod_operation_events');
    expect(RunpodBillingPeriod.collection.collectionName).toBe('runpod_billing_periods');
    expect(RunpodPodBillingPeriod.collection.collectionName).toBe('runpod_pod_billing_periods');
    expect(RunpodNetworkVolume.collection.collectionName).toBe('runpod_network_volumes');
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
      'ollama_pull', 'ollama_download',
    ]);
    expect(RunpodWorkloadTemplate.schema.path('providerTemplateId')).toBeDefined();
    expect(RunpodWorkloadTemplate.schema.path('persistentPath')).toBeDefined();
    expect(RunpodWorkloadTemplate.schema.path('defaultModel')).toBeDefined();
    expect(RunpodWorkloadTemplate.schema.path('apiKey')).toBeUndefined();
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
      'ollama_service', 'model_download',
    ]);
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
    ]));
    expect(RunpodOperationEvent.schema.path('outcome').options.enum).toEqual([
      'requested', 'succeeded', 'failed',
    ]);
  });
});
