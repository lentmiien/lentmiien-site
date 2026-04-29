const {
  MODEL_NAME,
  QUALITY_OPTIONS,
  BACKGROUND_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  MODERATION_OPTIONS,
  SIZE_PRESETS,
} = require('../gptImageService');

module.exports = [
  {
    name: 'generate_image',
    displayName: 'GPT Image Generation',
    description: 'Generate images with GPT Image 2, save them in public/img, and record the results in GptImageGeneration.',
    enabled: true,
    handlerKey: 'gptImage.generate',
    sourcePath: 'controllers/gptImageController.js',
    tags: ['openai', 'image', 'gpt-image'],
    toolDefinition: {
      type: 'function',
      name: 'generate_image',
      description: 'Generate one or more images from a text prompt. The tool returns saved /img URLs and markdown for displaying the generated images.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: {
            type: 'string',
            description: 'A detailed prompt describing the image to generate.',
          },
          n: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            default: 1,
            description: 'Number of images to generate.',
          },
          quality: {
            type: 'string',
            enum: QUALITY_OPTIONS,
            default: 'medium',
            description: 'Image quality setting.',
          },
          size: {
            type: 'string',
            enum: ['auto', ...SIZE_PRESETS.map((option) => option.value)],
            default: '1024x1024',
            description: 'Output size. Use auto or one of the supported GPT Image 2 sizes.',
          },
          background: {
            type: 'string',
            enum: BACKGROUND_OPTIONS,
            default: 'auto',
            description: 'Background handling for the image.',
          },
          output_format: {
            type: 'string',
            enum: OUTPUT_FORMAT_OPTIONS,
            default: 'png',
            description: 'Saved image format.',
          },
          output_compression: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            default: 100,
            description: 'Compression for JPEG and WebP output. Ignored for PNG.',
          },
          moderation: {
            type: 'string',
            enum: MODERATION_OPTIONS,
            default: 'auto',
            description: 'Image moderation strictness.',
          },
        },
        required: ['prompt'],
      },
      strict: false,
    },
    metadata: {
      model: MODEL_NAME,
      createdByDefault: 'Tool',
      storesFilesIn: 'public/img',
      storesRecordsIn: 'GptImageGeneration',
    },
  },
];
