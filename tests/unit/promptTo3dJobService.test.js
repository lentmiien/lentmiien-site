const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const pug = require('pug');
const sharp = require('sharp');

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const {
  PromptTo3dJobService,
  normalizeSubmission,
  serializeJob,
} = require('../../services/promptTo3dJobService');
const {
  BACKGROUND_OPTIONS,
  DEFAULT_FORM_VALUES,
  MODERATION_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  QUALITY_OPTIONS,
  SIZE_PRESETS,
} = require('../../services/gptImageService');
const { DEFAULT_PIXAL3D_PARAMETERS } = require('../../utils/pixal3d');

function queryResult(value) {
  return {
    lean: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(value),
    })),
  };
}

const user = {
  _id: { toString: () => 'owner-1' },
  name: 'Owner',
};

describe('PromptTo3dJobService', () => {
  test('normalizes a prompt-only submission to both tools defaults', () => {
    const submission = normalizeSubmission({ prompt: '  brass desk robot  ' }, user);

    expect(submission).toMatchObject({
      activeKey: 'user:owner-1',
      identity: { id: 'owner-1', name: 'Owner' },
      prompt: 'brass desk robot',
      imageOptions: {
        prompt: 'brass desk robot',
        n: 1,
        quality: DEFAULT_FORM_VALUES.quality,
        sizeMode: DEFAULT_FORM_VALUES.sizeMode,
        sizePreset: DEFAULT_FORM_VALUES.sizePreset,
        background: DEFAULT_FORM_VALUES.background,
        outputFormat: DEFAULT_FORM_VALUES.outputFormat,
        moderation: DEFAULT_FORM_VALUES.moderation,
      },
      pixal3dParameters: DEFAULT_PIXAL3D_PARAMETERS,
    });
  });

  test('validates Pixal3D settings before creating a background job', async () => {
    const JobModel = { create: jest.fn() };
    const service = new PromptTo3dJobService({
      JobModel,
      Pixal3dJobModel: {},
      imageGenerator: jest.fn(),
      pixal3dJobService: {},
    });

    await expect(service.createJob({
      raw: { prompt: 'robot', fov_degrees: '3' },
      user,
    })).rejects.toMatchObject({
      message: 'Camera FOV must be 0 for automatic estimation or between 5 and 120 degrees.',
      statusCode: 400,
    });
    expect(JobModel.create).not.toHaveBeenCalled();
  });

  test('rejects another submission while the same user has active work', async () => {
    const JobModel = { create: jest.fn() };
    const service = new PromptTo3dJobService({
      JobModel,
      Pixal3dJobModel: {},
      imageGenerator: jest.fn(),
      pixal3dJobService: {},
    });
    service.getActiveJob = jest.fn().mockResolvedValue({
      _id: 'wrapper-1',
      status: 'generating_model',
    });

    await expect(service.createJob({
      raw: { prompt: 'second robot' },
      user,
    })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(JobModel.create).not.toHaveBeenCalled();
  });

  test('saves the GPT Image output into a queued Pixal3D job', async () => {
    const publicRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-to-3d-'));
    try {
      const imageDirectory = path.join(publicRoot, 'img');
      await fs.mkdir(imageDirectory, { recursive: true });
      const imageFileName = 'gpt-image2-output-robot-test.png';
      const imageBuffer = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 4,
          background: { r: 255, g: 106, b: 31, alpha: 1 },
        },
      }).png().toBuffer();
      await fs.writeFile(path.join(imageDirectory, imageFileName), imageBuffer);

      const wrapperJob = {
        _id: 'wrapper-1',
        owner: { id: 'owner-1', name: 'Owner' },
        prompt: 'brass desk robot',
        status: 'generating_image',
        imageOptions: { ...DEFAULT_FORM_VALUES, prompt: 'brass desk robot', n: 1 },
        pixal3dParameters: { ...DEFAULT_PIXAL3D_PARAMETERS },
      };
      const JobModel = {
        findOneAndUpdate: jest.fn(() => queryResult(wrapperJob)),
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      };
      const Pixal3dJobModel = {
        create: jest.fn().mockResolvedValue({ _id: 'pixal-1' }),
      };
      const imageGenerator = jest.fn().mockResolvedValue({
        generationId: 'generation-1',
        images: [{
          id: 'image-1',
          outputFileName: imageFileName,
          outputUrl: `/img/${imageFileName}`,
        }],
      });
      const pixal3dJobService = {
        storeInputImage: jest.fn().mockResolvedValue({
          fileName: `${'a'.repeat(64)}.png`,
          publicUrl: `/img/${'a'.repeat(64)}.png`,
          mimeType: 'image/png',
        }),
        enqueue: jest.fn(),
        removeInputImage: jest.fn(),
      };
      const service = new PromptTo3dJobService({
        JobModel,
        Pixal3dJobModel,
        imageGenerator,
        pixal3dJobService,
        publicRoot,
      });
      service.startMonitor = jest.fn();

      await service.processJob('wrapper-1');

      expect(imageGenerator).toHaveBeenCalledWith(expect.objectContaining({
        rawOptions: expect.objectContaining({
          prompt: 'brass desk robot',
          n: 1,
        }),
        createdBy: 'Owner',
        openaiUser: 'owner-1',
      }));
      expect(pixal3dJobService.storeInputImage).toHaveBeenCalledWith(
        expect.any(Buffer),
        'png',
      );
      expect(Pixal3dJobModel.create).toHaveBeenCalledWith(expect.objectContaining({
        owner: { id: 'owner-1', name: 'Owner' },
        status: 'queued',
        inputImage: expect.objectContaining({
          format: 'png',
          width: 64,
          height: 48,
          sizeBytes: imageBuffer.length,
        }),
        parameters: DEFAULT_PIXAL3D_PARAMETERS,
      }));
      expect(JobModel.updateOne).toHaveBeenCalledWith(
        { _id: 'wrapper-1' },
        {
          $set: expect.objectContaining({
            status: 'generating_model',
            gptImageGenerationId: 'generation-1',
            gptImageId: 'image-1',
            imageUrl: `/img/${imageFileName}`,
            pixal3dJobId: 'pixal-1',
          }),
        },
      );
      expect(pixal3dJobService.enqueue).toHaveBeenCalledWith('pixal-1');
      expect(service.startMonitor).toHaveBeenCalledWith('wrapper-1', 'pixal-1');
    } finally {
      await fs.rm(publicRoot, { recursive: true, force: true });
    }
  });

  test('releases the active lock when Pixal3D completes', async () => {
    const terminalJob = {
      _id: 'wrapper-1',
      owner: { id: 'owner-1', name: 'Owner' },
      status: 'completed',
      pixal3dJobId: 'pixal-1',
    };
    const JobModel = {
      findOneAndUpdate: jest.fn(() => queryResult(terminalJob)),
    };
    const Pixal3dJobModel = {
      findOne: jest.fn(() => queryResult({
        _id: 'pixal-1',
        status: 'completed',
        outputModel: { fileName: `${'b'.repeat(64)}.glb` },
      })),
    };
    const service = new PromptTo3dJobService({
      JobModel,
      Pixal3dJobModel,
      imageGenerator: jest.fn(),
      pixal3dJobService: {},
    });

    const synced = await service.syncJob({
      _id: 'wrapper-1',
      owner: { id: 'owner-1', name: 'Owner' },
      status: 'generating_model',
      pixal3dJobId: 'pixal-1',
    });

    expect(synced.status).toBe('completed');
    expect(JobModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'wrapper-1', status: { $in: ['queued', 'generating_image', 'generating_model'] } },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'completed', error: null }),
        $unset: { activeKey: 1 },
      }),
      { new: true },
    );
  });

  test('builds links to both source tools and the completed preview', () => {
    expect(serializeJob({
      _id: 'wrapper-1',
      status: 'completed',
      prompt: 'robot',
      gptImageGenerationId: 'generation-1',
      pixal3dJobId: 'pixal-1',
    })).toMatchObject({
      imageGalleryUrl: '/gpt-image?highlight=generation-1',
      pixal3dUrl: '/pixal3d?wrapperJob=pixal-1',
      previewUrl: '/model-previewer/pixal3d/pixal-1',
    });
  });
});

describe('Prompt to 3D page', () => {
  test('renders prompt-only defaults and expandable settings for both tools', () => {
    const html = pug.renderFile(
      path.join(process.cwd(), 'views/prompt_to_3d/index.pug'),
      {
        pageConfig: {
          createEndpoint: '/prompt-to-3d/jobs',
          currentJob: null,
          pollIntervalMs: 4000,
        },
        imageDefaults: DEFAULT_FORM_VALUES,
        pixal3dDefaults: DEFAULT_PIXAL3D_PARAMETERS,
        imageOptions: {
          qualities: QUALITY_OPTIONS,
          backgrounds: BACKGROUND_OPTIONS,
          outputFormats: OUTPUT_FORMAT_OPTIONS,
          moderations: MODERATION_OPTIONS,
          sizes: SIZE_PRESETS,
        },
      },
    );

    expect(html).toContain('id="promptTo3dForm"');
    expect(html).toContain('name="prompt"');
    expect(html).toContain('<summary><span>Advanced settings</span>');
    expect(html).toContain('GPT Image settings');
    expect(html).toContain('Pixal3D settings');
    expect(html).toContain('name="sparse_structure_steps"');
    expect(html).toContain('name="texture_guidance_rescale"');
    expect(html).toContain('src="/js/prompt-to-3d.js"');
    expect(html).toContain('href="/css/prompt-to-3d.css"');
  });

  test('escapes current-job prompts inside the JSON page configuration', () => {
    const html = pug.renderFile(
      path.join(process.cwd(), 'views/prompt_to_3d/index.pug'),
      {
        pageConfig: {
          createEndpoint: '/prompt-to-3d/jobs',
          currentJob: {
            id: 'wrapper-1',
            status: 'generating_image',
            prompt: '</script><script>window.injected = true</script>',
          },
          pollIntervalMs: 4000,
        },
        imageDefaults: DEFAULT_FORM_VALUES,
        pixal3dDefaults: DEFAULT_PIXAL3D_PARAMETERS,
        imageOptions: {
          qualities: QUALITY_OPTIONS,
          backgrounds: BACKGROUND_OPTIONS,
          outputFormats: OUTPUT_FORMAT_OPTIONS,
          moderations: MODERATION_OPTIONS,
          sizes: SIZE_PRESETS,
        },
      },
    );

    const configStart = html.indexOf('<script id="promptTo3dPageConfig"');
    const configEnd = html.indexOf('</script>', configStart);
    const configScript = html.slice(configStart, configEnd);
    expect(configScript).toContain('\\u003c/script>');
    expect(configScript).not.toContain('<script>window.injected');
  });
});
