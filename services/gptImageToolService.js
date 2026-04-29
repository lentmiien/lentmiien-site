const {
  buildToolImageRequest,
  createImageGeneration,
} = require('./gptImageService');

class GptImageToolService {
  async execute(args = {}, context = {}) {
    const request = buildToolImageRequest(args);
    const result = await createImageGeneration({
      rawOptions: request.rawOptions,
      selectedImageIds: request.selectedImageIds,
      uploadedFiles: [],
      user: context.user || null,
      createdBy: context.createdBy || 'Tool',
      openaiUser: context.openaiUser || context.userId || context.userName || 'tool',
    });

    const images = result.images.map((image, index) => ({
      index,
      url: image.outputUrl,
      fileName: image.outputFileName,
      mimeType: image.outputMimeType,
      revisedPrompt: image.revisedPrompt,
      size: image.resolvedSize,
    }));

    return {
      ok: true,
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
