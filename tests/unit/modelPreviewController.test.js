const path = require('path');
const pug = require('pug');

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

jest.mock('../../models/trellis2_job', () => ({
  findOne: jest.fn(),
}));

jest.mock('../../models/pixal3d_job', () => ({
  findOne: jest.fn(),
}));

const Trellis2Job = require('../../models/trellis2_job');
const Pixal3dJob = require('../../models/pixal3d_job');
const controller = require('../../controllers/modelPreviewController');
const { THREE_VENDOR_BASE_URL } = require('../../utils/threeVendor');

function leanResult(value) {
  return {
    lean: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(value),
    })),
  };
}

function buildResponse() {
  const res = {
    render: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function buildRequest(source = 'trellis2', jobId = 'job-123') {
  return {
    params: { source, jobId },
    user: {
      _id: { toString: () => 'owner-1' },
      name: 'Owner',
    },
  };
}

describe('3D model preview controller', () => {
  test('renders an authorized completed TRELLIS.2 model with its protected download URL', async () => {
    Trellis2Job.findOne.mockReturnValue(leanResult({
      _id: 'job-123',
      status: 'completed',
      inputImage: { originalName: 'tiny robot.png' },
      outputModel: { fileName: `${'a'.repeat(64)}.glb` },
    }));
    const res = buildResponse();

    await controller.renderPreview(buildRequest(), res);

    expect(Trellis2Job.findOne).toHaveBeenCalledWith({
      $and: [
        { _id: 'job-123' },
        { $or: [{ 'owner.id': 'owner-1' }, { shared: true }] },
        { status: 'completed' },
        { 'outputModel.fileName': { $exists: true, $ne: '' } },
      ],
    });
    expect(res.render).toHaveBeenCalledWith('model_previewer', expect.objectContaining({
      pageTitle: 'tiny robot.png · 3D model preview',
      bodyClass: 'model-previewer-body',
      hideLayoutFooterSpacer: true,
      threeVendorBaseUrl: THREE_VENDOR_BASE_URL,
      preview: {
        source: 'trellis2',
        sourceLabel: 'TRELLIS.2',
        backUrl: '/trellis2',
        jobId: 'job-123',
        modelName: 'tiny robot.png',
        modelUrl: '/trellis2/jobs/job-123/download',
        downloadUrl: '/trellis2/jobs/job-123/download',
      },
    }));
  });

  test('uses the Pixal3D visibility query and source URLs', async () => {
    Pixal3dJob.findOne.mockReturnValue(leanResult({
      _id: 'pixal-job',
      status: 'completed',
      inputImage: {},
      outputModel: { fileName: `${'b'.repeat(64)}.glb` },
    }));
    const res = buildResponse();

    await controller.renderPreview(buildRequest('pixal3d', 'pixal-job'), res);

    expect(Pixal3dJob.findOne).toHaveBeenCalledWith(expect.objectContaining({
      $and: expect.arrayContaining([
        { _id: 'pixal-job' },
        { $or: [{ 'owner.id': 'owner-1' }, { shared: true }] },
      ]),
    }));
    expect(res.render).toHaveBeenCalledWith('model_previewer', expect.objectContaining({
      preview: expect.objectContaining({
        sourceLabel: 'Pixal3D',
        backUrl: '/pixal3d',
        modelName: 'Pixal3D model',
        modelUrl: '/pixal3d/jobs/pixal-job/download',
      }),
    }));
  });

  test.each([
    ['unknown', 'job-123'],
    ['trellis2', '../job-123'],
    ['trellis2', ''],
  ])('rejects invalid model links before querying a job (%s, %s)', async (source, jobId) => {
    const res = buildResponse();

    await controller.renderPreview(buildRequest(source, jobId), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('error_page', {
      error: 'Completed 3D model not found or you do not have access to it.',
    });
    expect(Trellis2Job.findOne).not.toHaveBeenCalled();
    expect(Pixal3dJob.findOne).not.toHaveBeenCalled();
  });

  test('does not render a missing, incomplete, or inaccessible model', async () => {
    Trellis2Job.findOne.mockReturnValue(leanResult(null));
    const res = buildResponse();

    await controller.renderPreview(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('error_page', {
      error: 'Completed 3D model not found or you do not have access to it.',
    });
  });
});

describe('3D model preview page', () => {
  test('renders the three preview modes, camera controls, and local Three.js imports', () => {
    const html = pug.renderFile(
      path.join(process.cwd(), 'views/model_previewer.pug'),
      {
        pageTitle: 'Model preview',
        bodyClass: 'model-previewer-body',
        contentContainerClass: 'model-previewer-container',
        hideLayoutFooterSpacer: true,
        loggedIn: true,
        permissions: [],
        htmlPaths: [],
        bookmarks: [],
        threeVendorBaseUrl: THREE_VENDOR_BASE_URL,
        preview: {
          sourceLabel: 'TRELLIS.2',
          backUrl: '/trellis2',
          modelName: 'tiny robot.png',
          modelUrl: '/trellis2/jobs/job-123/download',
          downloadUrl: '/trellis2/jobs/job-123/download',
        },
      },
    );

    expect(html).toContain('<link rel="stylesheet" href="/css/color-theme.css">');
    expect(html).toContain('<link rel="stylesheet" href="/css/model-previewer.css">');
    expect(html).toContain('data-model-url="/trellis2/jobs/job-123/download"');
    expect(html).toContain(`data-three-vendor-url="${THREE_VENDOR_BASE_URL}"`);
    expect(html).toContain('data-preview-mode="texture" aria-pressed="true" disabled>');
    expect(html).toContain('data-preview-mode="solid" aria-pressed="false" disabled>');
    expect(html).toContain('data-preview-mode="wireframe" aria-pressed="false" disabled>');
    expect(html).toContain('id="modelPreviewReset"');
    expect(html).toContain('Keyboard: arrows rotate, +/− zoom, 0 resets');
    expect(html).toContain(`"three":"${THREE_VENDOR_BASE_URL}/build/three.module.min.js"`);
    expect(html).toContain(`"three/addons/":"${THREE_VENDOR_BASE_URL}/addons/"`);
    expect(html).toContain('<script type="module" src="/js/model-previewer-bootstrap.js"></script>');
  });
});
