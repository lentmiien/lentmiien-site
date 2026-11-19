const sharp = require('sharp');
const ollama = require('../../utils/Ollama_API');
const { runFileOcr } = require('../ocrExtractionService');
const { DEFAULT_MODEL, MODEL_DEFINITIONS, validateOptions } = require('../ocrModelService');
const { MAX_TEXT, MAX_PIXELS } = require('./policy');
const { pageContext, pagePrompt, groupContext, groupPrompt, outputFormats, parseOutput } = require('./content');

const { appSettingsService, APP_SETTING_KEYS } = require('../appSettingsService');
const { DEFAULT_VAULT_CHAT_MODEL } = require('../data/defaultAppSettings');
async function generate({ group, job, scan, signal }) {
  const isGroup = job.kind === 'group';
  const page = !isGroup && group.pages.id(job.pageId);
  if (job.kind === 'ocr') {
    const { model, options } = validateOptions({ model: DEFAULT_MODEL }, { models: MODEL_DEFINITIONS });
    const source = { buffer: scan.bytes, size: scan.bytes.length, mimetype: scan.mime, originalname: 'scan.' + scan.mime.split('/')[1] };
    const result = await runFileOcr({ _id: String(job._id), model, options }, { id: String(page._id) }, source, { privateRequest: true, signal });
    if (result.layoutText.length > MAX_TEXT) throw new Error('OCR text exceeds vault limit.');
    return result.layoutText;
  }
  const model = await appSettingsService.getValue(APP_SETTING_KEYS.VAULT_CHAT_MODEL, DEFAULT_VAULT_CHAT_MODEL);
  if (!/^[a-z0-9][a-z0-9._/-]{0,119}(:[a-z0-9._-]{1,60})?$/i.test(model)) throw new Error('Invalid vault model setting.');
  const content = { text: isGroup ? groupPrompt(group.pages) : pagePrompt(page.ocrText) };
  if (!isGroup) {
    const image = await sharp(scan.bytes, { limitInputPixels: MAX_PIXELS })
      .autoOrient().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).timeout({ seconds: 15 }).toBuffer();
    content.images = [image.toString('base64')];
  }
  const options = { privateRequest: true, structuredOutput: outputFormats[job.kind], signal };
  const response = await ollama.chat({
    contextPrompt: isGroup ? groupContext : pageContext,
    metadata: { temperature: 0, max_tokens: isGroup ? 1024 : 8192 },
  }, [{ contentType: 'text', content }], { api_model: model, allow_images: true }, options);
  return parseOutput(job.kind, response);
}
module.exports = { generate };
