const MYPAGE_ICON_DEFINITIONS = [
  {
    id: 'my_life_log',
    href: '/admin/life_log',
    src: '/i/health.svg',
    alt: 'life log',
    label: 'My Life Log',
    adminOnly: true,
  },
  {
    id: 'learning',
    href: '/learning',
    src: '/i/learning.svg',
    alt: 'Play learning games',
    label: 'Learning Lab',
  },
  {
    id: 'write_blog',
    href: '/mypage/blogpost',
    src: '/i/blog.svg',
    alt: 'blogpost',
    label: 'Write blog',
  },
  {
    id: 'accounting',
    href: '/accounting',
    src: '/i/budget.svg',
    alt: 'accounting',
    label: 'Accounting',
    permissions: ['accounting'],
  },
  {
    id: 'chat5',
    href: '/chat5/top',
    src: '/i/chat5.svg',
    alt: 'chat5',
    label: 'Chat 5',
    permissions: ['chat5'],
  },
  {
    id: 'codex',
    href: '/codex',
    src: '/i/codex.svg',
    alt: 'Codex workspace assistant',
    label: 'Codex',
  },
  {
    id: 'knowledge',
    href: '/chat4/knowledgelist',
    src: '/i/knowledge.svg',
    alt: 'knowledge',
    label: 'Knowledge',
    permissions: ['chat4'],
  },
  {
    id: 'cooking_calendar',
    href: '/cooking/v2',
    src: '/i/calendar.svg',
    alt: 'cooking calendar',
    label: 'Cooking calendar',
    permissions: ['cooking'],
  },
  {
    id: 'cookbook',
    href: '/cooking/cookbook',
    src: '/i/cookbook.svg',
    alt: 'cookbook',
    label: 'Cookbook',
    permissions: ['cooking'],
  },
  {
    id: 'batch',
    href: '/chat4/batch_status',
    src: '/i/batch.svg',
    alt: 'batch',
    label: 'Batch',
  },
  {
    id: 'binpacking',
    href: '/binpacking',
    src: '/i/binpacking.svg',
    alt: '3D bin packing',
    label: '3D Bin Packing',
    permissions: ['binpacking'],
  },
  {
    id: 'pdf_to_image',
    href: '/mypage/pdf_to_jpg',
    src: '/i/pdfconv.svg',
    alt: 'PDF to image converter',
    label: 'PDF to Image',
  },
  {
    id: 'ocr',
    href: '/ocr',
    src: '/i/receipt.svg',
    alt: 'ocr tool',
    label: 'OCR tool',
    permissions: ['ocr'],
  },
  {
    id: 'ocr_tts',
    href: '/ocr-tts',
    src: '/i/receipt_tts.svg',
    alt: 'ocr to tts',
    label: 'OCR to TTS queue',
    permissions: ['ocr'],
  },
  {
    id: 'product_details',
    href: '/product',
    src: '/i/product.svg',
    alt: 'Product details',
    label: 'Product details',
    permissions: ['product'],
  },
  {
    id: 'gallery',
    href: '/gallery',
    src: '/i/gallery.svg',
    alt: 'Gallery',
    label: 'Gallery',
    permissions: ['gallery'],
  },
  {
    id: 'payroll',
    href: '/payroll',
    src: '/i/payroll.svg',
    alt: 'Payroll',
    label: 'Payroll',
    permissions: ['payroll'],
  },
  {
    id: 'emergency_stock',
    href: '/es/es_dashboard',
    src: '/i/stock.svg',
    alt: 'Emergency stock',
    label: 'Emergency stock',
    permissions: ['emergencystock'],
  },
  {
    id: 'schedule',
    href: '/scheduleTask/calendar',
    src: '/i/schedule.svg',
    alt: 'Calendar',
    label: 'Calendar',
    permissions: ['scheduletask'],
  },
  {
    id: 'image_gen',
    href: '/image_gen',
    src: '/i/img_gen.svg',
    alt: 'Generate and edit images',
    label: 'Image Gen',
    permissions: ['image_gen'],
  },
  {
    id: 'image_gen_bulk',
    href: '/image_gen/bulk',
    src: '/i/img_gen_bulk.svg',
    alt: 'Generate and edit images in batches',
    label: 'Image Gen bulk',
    permissions: ['image_gen'],
  },
  {
    id: 'music',
    href: '/music',
    src: '/i/music.svg',
    alt: 'AI music library',
    label: 'Music',
    permissions: ['music'],
  },
  {
    id: 'sora',
    href: '/sora',
    src: '/i/vid_gen.svg',
    alt: 'Generate and edit short videos',
    label: 'Video Gen',
    permissions: ['sora'],
  },
  {
    id: 'qwen3_lora_text',
    href: '/qwen3-lora',
    src: '/i/qwen3_lora.svg',
    alt: 'Qwen3 LoRA text generation',
    label: 'Qwen3 Text',
  },
  {
    id: 'credit_card',
    href: '/budget/cards',
    src: '/i/credit.svg',
    alt: 'Credit Card usage',
    label: 'Credit Card',
    permissions: ['budget'],
  },
  {
    id: 'shopping_list',
    href: '/shopping-list',
    src: '/i/shopping.svg',
    alt: 'Shopping list',
    label: 'Shopping list',
    permissions: ['shoppinglist'],
  },
  {
    id: 'qwen3_lora',
    href: '/admin/qwen3-lora',
    src: '/i/qwen3_lora.svg',
    alt: 'Qwen3 LoRA admin tool',
    label: 'Qwen3 LoRA',
    adminOnly: true,
  },
  {
    id: 'request_counter',
    href: '/admin/request-counter',
    src: '/i/request_counter.svg',
    alt: 'Request counter admin dashboard',
    label: 'Request Counter',
    adminOnly: true,
  },
  {
    id: 'device_usage',
    href: '/admin/device-usage',
    src: '/i/device_usage.svg',
    alt: 'Device usage admin dashboard',
    label: 'Device Usage',
    adminOnly: true,
  },
  {
    id: 'minute_logger',
    href: '/admin/minute-logger',
    src: '/i/minute_logger.svg',
    alt: 'Minute logger admin dashboard',
    label: 'Minute Logger',
    adminOnly: true,
  },
  {
    id: 'tapo',
    href: '/admin/tapo',
    src: '/i/tapo.svg',
    alt: 'Tapo power dashboard',
    label: 'Tapo Power',
    adminOnly: true,
  },
  {
    id: 'disaster_dashboard',
    href: '/admin/disasters',
    src: '/i/disaster.svg',
    alt: 'Disaster dashboard',
    label: 'Disaster Watch',
    adminOnly: true,
  },
  {
    id: 'ai_gateway',
    href: '/admin/ai-gateway',
    src: '/i/ai_gateway.svg',
    alt: 'AI Gateway admin dashboard',
    label: 'AI Gateway',
    adminOnly: true,
  },
];

const DEFINITION_IDS = MYPAGE_ICON_DEFINITIONS.map((definition) => definition.id);

function normalizeStringArray(value) {
  const source = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  const seen = new Set();
  const output = [];

  source.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    output.push(trimmed);
  });

  return output;
}

function normalizeMypageIconSettings(settings = {}) {
  return {
    order: normalizeStringArray(settings.order),
    hidden: normalizeStringArray(settings.hidden),
  };
}

function hasRequiredPermissions(definition, permissions = [], options = {}) {
  if (definition.adminOnly && !options.isAdmin) {
    return false;
  }
  if (!Array.isArray(definition.permissions) || definition.permissions.length === 0) {
    return true;
  }
  return definition.permissions.every((permission) => permissions.indexOf(permission) >= 0);
}

function getAllowedMypageIconDefinitions(permissions = [], options = {}) {
  return MYPAGE_ICON_DEFINITIONS.filter((definition) => hasRequiredPermissions(definition, permissions, options));
}

function orderDefinitions(definitions, savedOrder = []) {
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const orderedIds = [];

  savedOrder.forEach((id) => {
    if (definitionById.has(id) && orderedIds.indexOf(id) === -1) {
      orderedIds.push(id);
    }
  });

  definitions.forEach((definition) => {
    if (orderedIds.indexOf(definition.id) === -1) {
      orderedIds.push(definition.id);
    }
  });

  return orderedIds.map((id) => definitionById.get(id));
}

function buildMypageTiles({ permissions = [], settings = {}, metaById = {}, isAdmin = false } = {}) {
  const normalizedSettings = normalizeMypageIconSettings(settings);
  const hidden = new Set(normalizedSettings.hidden);

  return orderDefinitions(getAllowedMypageIconDefinitions(permissions, { isAdmin }), normalizedSettings.order)
    .map((definition) => ({
      ...definition,
      meta: Object.prototype.hasOwnProperty.call(metaById, definition.id)
        ? metaById[definition.id]
        : definition.meta || null,
      hidden: hidden.has(definition.id),
    }));
}

function sanitizeMypageIconSettings(input = {}, previousSettings = {}, permissions = [], options = {}) {
  const definitionIds = new Set(DEFINITION_IDS);
  const allowedIds = new Set(getAllowedMypageIconDefinitions(permissions, options).map((definition) => definition.id));
  const previous = normalizeMypageIconSettings(previousSettings);
  const submitted = normalizeMypageIconSettings(input);

  const submittedAllowedOrder = submitted.order.filter((id) => definitionIds.has(id) && allowedIds.has(id));
  const mergedOrder = [];

  submittedAllowedOrder.forEach((id) => {
    if (mergedOrder.indexOf(id) === -1) {
      mergedOrder.push(id);
    }
  });

  previous.order.forEach((id) => {
    if (definitionIds.has(id) && mergedOrder.indexOf(id) === -1) {
      mergedOrder.push(id);
    }
  });

  DEFINITION_IDS.forEach((id) => {
    if (mergedOrder.indexOf(id) === -1) {
      mergedOrder.push(id);
    }
  });

  const hidden = [];
  submitted.hidden.forEach((id) => {
    if (definitionIds.has(id) && allowedIds.has(id) && hidden.indexOf(id) === -1) {
      hidden.push(id);
    }
  });
  previous.hidden.forEach((id) => {
    if (definitionIds.has(id) && !allowedIds.has(id) && hidden.indexOf(id) === -1) {
      hidden.push(id);
    }
  });

  return {
    order: mergedOrder,
    hidden,
    updatedAt: new Date(),
  };
}

module.exports = {
  MYPAGE_ICON_DEFINITIONS,
  buildMypageTiles,
  getAllowedMypageIconDefinitions,
  normalizeMypageIconSettings,
  sanitizeMypageIconSettings,
};
