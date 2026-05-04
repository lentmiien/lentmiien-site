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
  {
    name: 'add_todo',
    displayName: 'Add Todo',
    description: 'Create a new todo task for Lennart in the schedule task database.',
    enabled: true,
    handlerKey: 'scheduleTask.createTodo',
    sourcePath: 'services/scheduleTaskToolService.js',
    tags: ['schedule-task', 'todo', 'task'],
    toolDefinition: {
      type: 'function',
      name: 'add_todo',
      description: 'Create a new todo for Lennart. start and end are optional and should be omitted when not needed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: {
            type: 'string',
            description: 'Short todo title.',
          },
          description: {
            type: 'string',
            description: 'Optional details for the todo.',
          },
          start: {
            type: 'string',
            description: 'Optional ISO 8601 date or datetime for when the todo starts.',
          },
          end: {
            type: 'string',
            description: 'Optional ISO 8601 date or datetime for when the todo ends or is due.',
          },
        },
        required: ['title'],
      },
      strict: false,
    },
    metadata: {
      taskType: 'todo',
      fixedUserId: 'Lennart',
      createdByDefault: 'Tool',
      storesRecordsIn: 'Task',
    },
  },
  {
    name: 'add_tobuy',
    displayName: 'Add To-Buy Item',
    description: 'Create a new to-buy task for Lennart in the schedule task database.',
    enabled: true,
    handlerKey: 'scheduleTask.createTobuy',
    sourcePath: 'services/scheduleTaskToolService.js',
    tags: ['schedule-task', 'tobuy', 'shopping'],
    toolDefinition: {
      type: 'function',
      name: 'add_tobuy',
      description: 'Create a new to-buy item for Lennart. start and end are optional and should be omitted when not needed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: {
            type: 'string',
            description: 'Short to-buy title.',
          },
          description: {
            type: 'string',
            description: 'Optional details for the to-buy item.',
          },
          start: {
            type: 'string',
            description: 'Optional ISO 8601 date or datetime for when the to-buy item starts.',
          },
          end: {
            type: 'string',
            description: 'Optional ISO 8601 date or datetime for when the to-buy item ends or is due.',
          },
        },
        required: ['title'],
      },
      strict: false,
    },
    metadata: {
      taskType: 'tobuy',
      fixedUserId: 'Lennart',
      createdByDefault: 'Tool',
      storesRecordsIn: 'Task',
    },
  },
  {
    name: 'add_quick_note',
    displayName: 'Add Quick Note',
    description: 'Create a new quick note for Lennart with a fixed Home location.',
    enabled: true,
    handlerKey: 'scheduleTask.createQuickNote',
    sourcePath: 'services/scheduleTaskToolService.js',
    tags: ['quick-note', 'note', 'location'],
    toolDefinition: {
      type: 'function',
      name: 'add_quick_note',
      description: 'Create a new quick note for Lennart. This tool always saves the note with the fixed Home coordinates 139.54047677, 35.46015017 and nearestLocation Home.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: {
            type: 'string',
            description: 'The quick note text to save.',
          },
        },
        required: ['content'],
      },
      strict: false,
    },
    metadata: {
      fixedUserId: 'Lennart',
      fixedCoordinates: [139.54047677, 35.46015017],
      nearestLocation: {
        name: 'Home',
        distance: 0,
      },
      storesRecordsIn: 'QuickNote',
    },
  },
  {
    name: 'add_knowledge',
    displayName: 'Add Knowledge Entry',
    description: 'Create a new Chat4 knowledge entry for Lennart.',
    enabled: true,
    handlerKey: 'knowledge.create',
    sourcePath: 'services/knowledgeToolService.js',
    tags: ['knowledge', 'memory', 'chat4'],
    toolDefinition: {
      type: 'function',
      name: 'add_knowledge',
      description: 'Save durable knowledge for Lennart. Use short broad category terms and include images only when a usable existing filename is available.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: {
            type: 'string',
            description: 'Short title for the knowledge entry, 100 characters or fewer.',
          },
          contentMarkdown: {
            type: 'string',
            description: 'Knowledge content to save, formatted as Markdown.',
          },
          category: {
            type: 'string',
            description: 'Short generic grouping term, such as coding, recipe, finance, health, home, or travel.',
          },
          tags: {
            type: 'array',
            description: 'Specific tags for lookup. Use short terms; spaces will be normalized to underscores.',
            items: {
              type: 'string',
            },
            default: [],
          },
          images: {
            type: 'array',
            description: 'Optional existing image filenames from the conversation. Leave empty when no usable filename exists.',
            items: {
              type: 'string',
            },
            default: [],
          },
        },
        required: ['title', 'contentMarkdown', 'category', 'tags'],
      },
      strict: false,
    },
    metadata: {
      fixedUserId: 'Lennart',
      defaultOriginConversationId: 'none',
      fixedOriginType: 'chat5',
      storesRecordsIn: 'chat4_knowledge',
    },
  },
  {
    name: 'fetch_todos',
    displayName: 'Fetch Open Todos',
    description: 'Fetch Lennart\'s open todo tasks for a date window.',
    enabled: true,
    handlerKey: 'scheduleTask.fetchTodos',
    sourcePath: 'services/scheduleTaskToolService.js',
    tags: ['schedule-task', 'todo', 'read'],
    toolDefinition: {
      type: 'function',
      name: 'fetch_todos',
      description: 'Fetch open todos for Lennart within a date window. Use from and to as ISO 8601 dates or datetimes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: {
            type: 'string',
            description: 'Start of the date window as an ISO 8601 date or datetime.',
          },
          to: {
            type: 'string',
            description: 'End of the date window as an ISO 8601 date or datetime.',
          },
        },
        required: ['from', 'to'],
      },
      strict: false,
    },
    metadata: {
      taskType: 'todo',
      fixedUserId: 'Lennart',
      doneFilter: false,
      storesRecordsIn: 'Task',
    },
  },
  {
    name: 'fetch_tobuys',
    displayName: 'Fetch Open To-Buy Items',
    description: 'Fetch Lennart\'s open to-buy tasks for a date window.',
    enabled: true,
    handlerKey: 'scheduleTask.fetchTobuys',
    sourcePath: 'services/scheduleTaskToolService.js',
    tags: ['schedule-task', 'tobuy', 'read'],
    toolDefinition: {
      type: 'function',
      name: 'fetch_tobuys',
      description: 'Fetch open to-buy items for Lennart within a date window. Use from and to as ISO 8601 dates or datetimes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: {
            type: 'string',
            description: 'Start of the date window as an ISO 8601 date or datetime.',
          },
          to: {
            type: 'string',
            description: 'End of the date window as an ISO 8601 date or datetime.',
          },
        },
        required: ['from', 'to'],
      },
      strict: false,
    },
    metadata: {
      taskType: 'tobuy',
      fixedUserId: 'Lennart',
      doneFilter: false,
      storesRecordsIn: 'Task',
    },
  },
];
