const { MODEL_NAME } = require('./gptImageModels');
const { resolveAuthorizedToolPrincipal } = require('./toolExecutionPrincipalService');
const { GPT_IMAGE_CAPABILITIES, gptImageRoleBundles } = require('../utils/gptImageAuthorizationPolicy');
const {
  buildToolImageRequest,
  createImageGeneration,
} = require('./gptImageService');

class GptImageToolService {
  async execute(args = {}, context = {}, model = MODEL_NAME) {
    const principal = await resolveAuthorizedToolPrincipal(context, [GPT_IMAGE_CAPABILITIES.generate, GPT_IMAGE_CAPABILITIES.read], {
      roleCapabilityBundles: gptImageRoleBundles(context.user),
    });
    const request = buildToolImageRequest(args);
    const result = await createImageGeneration({
      rawOptions: { ...request.rawOptions, model },
      selectedImageIds: request.selectedImageIds,
      uploadedFiles: [],
      user: principal,
      createdBy: 'Tool',
      openaiUser: principal._id,
    });

    const images = result.images.map((image, index) => ({
      index,
      id: image.id,
      model: image.model,
      modelLabel: image.modelLabel,
      url: image.outputUrl,
      fileName: image.outputFileName,
      mimeType: image.outputMimeType,
      revisedPrompt: image.revisedPrompt,
      size: image.resolvedSize,
    }));

    return {
      ok: true,
      model,
      generationId: result.generationId,
      requestType: result.requestType,
      createdCount: result.createdCount,
      images,
      markdown: images
        .map((image, index) => `![Generated image ${index + 1}](${image.url})`)
        .join('\n\n'),
    };
  }
}

module.exports = GptImageToolService;
