const fs = require('fs');
const path = require('path');
const pug = require('pug');
const qwen3TrainingGuideController = require('../../controllers/qwen3TrainingGuideController');
const { renderDocumentationMarkdown } = require('../../services/aiGatewayDocumentationService');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

function layoutLocals(overrides = {}) {
  return {
    pageTitle: 'Qwen3 LoRA & QLoRA Training Guide',
    loggedIn: true,
    admin: true,
    permissions: [],
    htmlPaths: [],
    bookmarks: [],
    currentPath: '/admin/qwen3-training-guide',
    ...overrides,
  };
}

function renderTool(toolName) {
  return pug.renderFile(projectFile('views', 'admin_qwen3_lora.pug'), layoutLocals({
    apiBase: 'http://gateway.test:8080',
    servicePrefix: toolName === 'Qwen3 QLoRA' ? '/qwen3-qlora' : '/qwen3-lora',
    defaultTrainingParams: {
      num_train_epochs: 1,
      learning_rate: 0.0002,
      per_device_train_batch_size: 1,
      gradient_accumulation_steps: 8,
      max_seq_length: 512,
      lora_r: 16,
      lora_alpha: 32,
      lora_dropout: 0.05,
      seed: 42,
    },
    maxCompareTargets: 4,
    maxUploadMb: 100,
    trainingGroups: [],
    toolName,
  }));
}

describe('Qwen3 adapter training guide page', () => {
  test('renders the local Markdown guide with model, data, parameter, and evaluation guidance', () => {
    const guideMarkdown = fs.readFileSync(
      projectFile('documentation', 'qwen3-adapter-training-guide.md'),
      'utf8',
    );
    const html = pug.renderFile(
      projectFile('views', 'admin_qwen3_training_guide.pug'),
      layoutLocals({ guideHtml: renderDocumentationMarkdown(guideMarkdown) }),
    );

    expect(html).toContain('Qwen3 LoRA &amp; QLoRA training guide');
    expect(html).toContain('id="choose-the-tool"');
    expect(html).toContain('Qwen/Qwen3-4B-Instruct-2507');
    expect(html).toContain('Qwen/Qwen3-32B');
    expect(html).toContain('id="sample-size-guidance"');
    expect(html).toContain('id="training-parameter-reference"');
    expect(html).toContain('effective batch');
    expect(html).toContain('id="diagnosis-and-next-actions"');
    expect(html).toContain('href="/admin/qwen3-lora"');
    expect(html).toContain('href="/admin/qwen3-qlora"');
    expect(html).toContain('/css/qwen3_training_guide.css');
  });

  test('loads and renders the Markdown through the admin controller', async () => {
    const req = { originalUrl: '/admin/qwen3-training-guide' };
    const res = { render: jest.fn().mockReturnValue('rendered') };

    await expect(qwen3TrainingGuideController.render(req, res)).resolves.toBe('rendered');
    expect(res.render).toHaveBeenCalledWith(
      'admin_qwen3_training_guide',
      expect.objectContaining({
        pageTitle: 'Qwen3 LoRA & QLoRA Training Guide',
        guideHtml: expect.stringContaining('id="training-parameter-reference"'),
      }),
    );
  });

  test('links to the same standalone guide from both training tools', () => {
    const loraHtml = renderTool('Qwen3 LoRA');
    const qloraHtml = renderTool('Qwen3 QLoRA');

    expect(loraHtml).toContain('href="/admin/qwen3-training-guide"');
    expect(qloraHtml).toContain('href="/admin/qwen3-training-guide"');
    expect(loraHtml).toContain('Training guide');
    expect(qloraHtml).toContain('Training guide');
  });

  test('registers the standalone page inside the authenticated admin router', () => {
    const routeSource = fs.readFileSync(projectFile('routes', 'admin.js'), 'utf8');
    const appSource = fs.readFileSync(projectFile('app.js'), 'utf8');

    expect(routeSource).toContain(
      "router.get('/qwen3-training-guide', qwen3TrainingGuideController.render);",
    );
    expect(appSource).toContain("app.use('/admin', isAuthenticated, isAdmin, adminRouter);");
  });
});
