(function (root, factory) {
  const loader = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = loader;
  } else {
    root.Brickify3DModelLoader = loader;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const MODEL_SOURCES = Object.freeze({
    trellis2: Object.freeze({
      downloadBase: '/trellis2/jobs/',
      filePrefix: 'trellis2',
      label: 'TRELLIS.2',
    }),
    pixal3d: Object.freeze({
      downloadBase: '/pixal3d/jobs/',
      filePrefix: 'pixal3d',
      label: 'Pixal3D',
    }),
  });
  const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

  function parseLinkedModel(search) {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const source = params.get('source');
    const jobId = params.get('jobId');

    if (!source && !jobId) return null;
    if (!Object.prototype.hasOwnProperty.call(MODEL_SOURCES, source) || !JOB_ID_PATTERN.test(jobId || '')) {
      throw new Error('This model link is invalid. Open the converter again from a completed 3D model job.');
    }

    const sourceConfig = MODEL_SOURCES[source];
    return {
      source,
      sourceLabel: sourceConfig.label,
      jobId,
      downloadUrl: sourceConfig.downloadBase + encodeURIComponent(jobId) + '/download',
      fileName: sourceConfig.filePrefix + '-' + jobId + '.glb',
    };
  }

  function hasGlbHeader(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) return false;
    const header = new DataView(buffer, 0, 12);
    const declaredLength = header.getUint32(8, true);
    return header.getUint32(0, true) === 0x46546c67
      && header.getUint32(4, true) === 2
      && declaredLength >= 12
      && declaredLength <= buffer.byteLength;
  }

  async function fetchLinkedModel(request, options = {}) {
    if (!request?.downloadUrl || !request?.fileName) {
      throw new Error('The linked model request is incomplete.');
    }
    const fetchImpl = options.fetchImpl || root.fetch;
    const FileConstructor = options.FileConstructor || root.File;
    if (typeof fetchImpl !== 'function' || typeof FileConstructor !== 'function') {
      throw new Error('This browser cannot load the linked model automatically.');
    }

    const fetchOptions = {
      credentials: 'same-origin',
      headers: {
        Accept: 'model/gltf-binary, application/octet-stream',
      },
    };
    if (options.signal) fetchOptions.signal = options.signal;
    const response = await fetchImpl(request.downloadUrl, fetchOptions);
    if (response.redirected) {
      throw new Error('Your session expired while loading the model. Sign in and open the job again.');
    }
    if (!response.ok) {
      throw new Error('The linked model is unavailable or is no longer shared with you.');
    }

    const buffer = await response.arrayBuffer();
    if (!hasGlbHeader(buffer)) {
      throw new Error('The job did not return a valid GLB model.');
    }
    return new FileConstructor([buffer], request.fileName, { type: 'model/gltf-binary' });
  }

  return Object.freeze({
    fetchLinkedModel,
    hasGlbHeader,
    parseLinkedModel,
  });
}));
