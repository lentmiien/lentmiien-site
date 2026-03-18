const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');

const LearningTopic = require('../models/learning_topic');
const LearningSubtopic = require('../models/learning_subtopic');
const LearningItem = require('../models/learning_item');
const LearningProgress = require('../models/learning_progress');
const LearningAttempt = require('../models/learning_attempt');
const LearningArtAsset = require('../models/learning_art_asset');
const UserAccount = require('../models/useraccount');
const logger = require('../utils/logger');

const CONTENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
});

const TEMPLATE_TYPES = Object.freeze({
  SCENE: 'scene',
  SINGLE_CHOICE: 'single_choice',
  COUNT_TARGET: 'count_target',
  BUILDER_SEQUENCE: 'builder_sequence',
  STATE_CHANGE: 'state_change',
});

const SCENE_TYPES = Object.freeze({
  ATOM_PLAY: 'atom_play',
  MOLECULE_BUILDER: 'molecule_builder',
  PARTICLE_PARTY: 'particle_party',
});

const ART_KINDS = Object.freeze({
  BUILTIN: 'builtin',
  EMOJI: 'emoji',
  IMAGE: 'image',
});

const STATE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'liquid', label: 'Liquid' },
  { value: 'gas', label: 'Gas' },
];

const ART_KIND_OPTIONS = [
  { value: ART_KINDS.BUILTIN, label: 'Built-in art' },
  { value: ART_KINDS.EMOJI, label: 'Emoji' },
  { value: ART_KINDS.IMAGE, label: 'Image URL' },
];

const TEMPLATE_OPTIONS = [
  { value: TEMPLATE_TYPES.SCENE, label: 'Interactive scene' },
  { value: TEMPLATE_TYPES.SINGLE_CHOICE, label: 'Single choice' },
  { value: TEMPLATE_TYPES.COUNT_TARGET, label: 'Counting target' },
  { value: TEMPLATE_TYPES.BUILDER_SEQUENCE, label: 'Builder sequence' },
  { value: TEMPLATE_TYPES.STATE_CHANGE, label: 'State change controls' },
];

const SCENE_OPTIONS = [
  { value: SCENE_TYPES.ATOM_PLAY, label: 'Atom play scene' },
  { value: SCENE_TYPES.MOLECULE_BUILDER, label: 'Molecule builder scene' },
  { value: SCENE_TYPES.PARTICLE_PARTY, label: 'Particle party scene' },
];

const PATTERN_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'bubbles', label: 'Bubbles' },
  { value: 'stars', label: 'Stars' },
  { value: 'dots', label: 'Dots' },
];

const ADMIN_DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const ADMIN_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
});

const DEFAULT_THEME = Object.freeze({
  accentColor: '#ffb703',
  accentColorSoft: '#ffd166',
  backgroundStart: '#081225',
  backgroundEnd: '#0b2a42',
  glowColor: 'rgba(56,189,248,0.25)',
  backgroundImageUrl: '',
  pattern: 'bubbles',
  iconArt: { kind: ART_KINDS.BUILTIN, value: 'chemistry' },
  mascotArt: { kind: ART_KINDS.BUILTIN, value: 'mascot' },
  badgeArt: { kind: ART_KINDS.EMOJI, value: '⭐' },
});

const DEFAULT_REWARD = Object.freeze({
  label: 'Sticker',
  description: '',
  stickerArt: { kind: ART_KINDS.EMOJI, value: '🏅' },
});

const BUILTIN_ART_FALLBACKS = Object.freeze({
  mascot: '🐱',
  chemistry: '🧪',
  atom: '⚛️',
  molecule: '💧',
  mixture: '✨',
  states: '☁️',
  water: '💧',
  star: '⭐',
  solid: '🧊',
  liquid: '💦',
  gas: '☁️',
  'solid-box': '🧊',
  'liquid-box': '💦',
  'gas-box': '☁️',
  'molecule-h2o': '💧',
  'molecule-co2': '🫧',
  'molecule-o2': '🫧',
  colors: '🎨',
  animals: '🐾',
  space: '🚀',
  numbers: '🔢',
});

const CUSTOM_ART_PLACEHOLDER = '🖼️';

const SYSTEM_BUILTIN_ART_CHOICES = Object.freeze(
  Object.entries(BUILTIN_ART_FALLBACKS).map(([key, previewText]) => ({
    key,
    title: key
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    description: 'System built-in art',
    previewText,
    previewHtml: '',
    source: 'system',
  }))
);

const SYSTEM_BUILTIN_ART_KEY_SET = new Set(SYSTEM_BUILTIN_ART_CHOICES.map((entry) => entry.key));

const CHEMISTRY_SEED = Object.freeze({
  topic: {
    stableId: 'topic_chemistry_core',
    slug: 'chemistry',
    title: 'Chemistry',
    shortLabel: 'Chemistry',
    description: 'Friendly science play with atoms, molecules, and particle fun.',
    status: CONTENT_STATUS.PUBLISHED,
    order: 1,
    theme: {
      accentColor: '#ffb703',
      accentColorSoft: '#ffd166',
      backgroundStart: '#081225',
      backgroundEnd: '#0b2a42',
      glowColor: 'rgba(56,189,248,0.25)',
      pattern: 'bubbles',
      iconArt: { kind: ART_KINDS.BUILTIN, value: 'chemistry' },
      mascotArt: { kind: ART_KINDS.BUILTIN, value: 'mascot' },
      badgeArt: { kind: ART_KINDS.EMOJI, value: '⭐' },
    },
  },
  subtopics: [
    {
      stableId: 'subtopic_chemistry_atoms',
      slug: 'atoms',
      title: 'Atoms',
      description: 'Meet the tiny building blocks that make up matter.',
      status: CONTENT_STATUS.PUBLISHED,
      order: 1,
      estimatedMinutes: 3,
      theme: {
        accentColor: '#ffb703',
        accentColorSoft: '#ffe7a0',
        iconArt: { kind: ART_KINDS.BUILTIN, value: 'atom' },
        badgeArt: { kind: ART_KINDS.BUILTIN, value: 'atom' },
      },
      reward: {
        label: 'Atom Explorer',
        description: 'You met the tiny building blocks.',
        stickerArt: { kind: ART_KINDS.BUILTIN, value: 'atom' },
      },
      items: [
        {
          stableId: 'item_chemistry_atoms_scene',
          title: 'Meet an Atom',
          prompt: 'Atoms are tiny!',
          helperText: 'Tap + to add electrons and watch them zoom.',
          blurb: 'Play with the atom before the quiz questions start.',
          kind: 'activity',
          templateType: TEMPLATE_TYPES.SCENE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 1,
          points: 0,
          config: {
            sceneType: SCENE_TYPES.ATOM_PLAY,
            bodyText: 'They have a middle called the nucleus and electrons moving around it.',
            hintText: 'Try adding and removing a few electrons.',
            completeMessage: 'Great exploring!',
          },
        },
        {
          stableId: 'item_chemistry_atoms_q1',
          title: 'Which picture shows one atom?',
          prompt: 'Which picture shows ONE atom?',
          helperText: 'Tap the picture you think is right.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.SINGLE_CHOICE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 2,
          points: 1,
          config: {
            options: [
              { key: 'atom', label: 'Atom', art: { kind: ART_KINDS.BUILTIN, value: 'atom' } },
              { key: 'molecule', label: 'Molecule', art: { kind: ART_KINDS.BUILTIN, value: 'molecule' } },
              { key: 'mixture', label: 'Mixture', art: { kind: ART_KINDS.BUILTIN, value: 'mixture' } },
            ],
            correctOptionKey: 'atom',
            goodFeedback: 'Yes! One atom is one tiny piece.',
            badFeedback: 'Not quite. Try again!',
          },
        },
        {
          stableId: 'item_chemistry_atoms_q2',
          title: 'The middle of an atom',
          prompt: 'The middle of an atom is called the…',
          helperText: 'Choose the science word.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.SINGLE_CHOICE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 3,
          points: 1,
          config: {
            options: [
              { key: 'nucleus', label: 'Nucleus', art: { kind: ART_KINDS.EMOJI, value: '🎯' } },
              { key: 'pizza', label: 'Pizza', art: { kind: ART_KINDS.EMOJI, value: '🍕' } },
              { key: 'backpack', label: 'Backpack', art: { kind: ART_KINDS.EMOJI, value: '🎒' } },
            ],
            correctOptionKey: 'nucleus',
            goodFeedback: 'Correct: nucleus means the middle!',
            badFeedback: 'Oops — try again.',
          },
        },
        {
          stableId: 'item_chemistry_atoms_q3',
          title: 'Count the electrons',
          prompt: 'Add exactly 2 electrons!',
          helperText: 'Use the buttons, then tap check.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.COUNT_TARGET,
          status: CONTENT_STATUS.PUBLISHED,
          order: 4,
          points: 1,
          config: {
            target: 2,
            max: 8,
            counterLabel: 'Electrons',
            goodFeedback: 'Nice counting! 2 electrons.',
            badFeedback: 'Almost. Try again!',
          },
        },
      ],
    },
    {
      stableId: 'subtopic_chemistry_molecules',
      slug: 'molecules',
      title: 'Molecules',
      description: 'See how atoms hold hands to make molecules.',
      status: CONTENT_STATUS.PUBLISHED,
      order: 2,
      estimatedMinutes: 4,
      theme: {
        accentColor: '#38bdf8',
        accentColorSoft: '#bae6fd',
        iconArt: { kind: ART_KINDS.BUILTIN, value: 'molecule' },
        badgeArt: { kind: ART_KINDS.BUILTIN, value: 'water' },
      },
      reward: {
        label: 'Molecule Maker',
        description: 'You built atoms into a friendly molecule.',
        stickerArt: { kind: ART_KINDS.BUILTIN, value: 'water' },
      },
      items: [
        {
          stableId: 'item_chemistry_molecules_scene',
          title: 'Build a Molecule',
          prompt: 'Molecules are atoms holding hands.',
          helperText: 'Tap an atom, then tap a bubble to place it.',
          blurb: 'Try making H-O-H for water or O-C-O for carbon dioxide.',
          kind: 'activity',
          templateType: TEMPLATE_TYPES.SCENE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 1,
          points: 0,
          config: {
            sceneType: SCENE_TYPES.MOLECULE_BUILDER,
            bodyText: 'Build little teams of atoms and watch them snap together.',
            hintText: 'Try H-O-H or O-C-O.',
            pieces: ['H', 'H', 'O', 'O', 'C'],
            slotCount: 3,
            completeMessage: 'Nice building!',
          },
        },
        {
          stableId: 'item_chemistry_molecules_q1',
          title: 'What is a molecule?',
          prompt: 'A molecule is…',
          helperText: 'Look for atoms working together.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.SINGLE_CHOICE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 2,
          points: 1,
          config: {
            options: [
              { key: 'team', label: 'A team of atoms', art: { kind: ART_KINDS.BUILTIN, value: 'molecule' } },
              { key: 'single', label: 'One atom', art: { kind: ART_KINDS.BUILTIN, value: 'atom' } },
              { key: 'mix', label: 'A mix not holding hands', art: { kind: ART_KINDS.BUILTIN, value: 'mixture' } },
            ],
            correctOptionKey: 'team',
            goodFeedback: 'Yep! Molecules are atoms together.',
            badFeedback: 'Try again — look for “together”.',
          },
        },
        {
          stableId: 'item_chemistry_molecules_q2',
          title: 'Build water',
          prompt: 'Build WATER: H - O - H',
          helperText: 'Tap a piece, then tap a slot. Tap a filled slot to remove it.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.BUILDER_SEQUENCE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 3,
          points: 1,
          config: {
            pieces: ['H', 'H', 'O'],
            targetSequence: ['H', 'O', 'H'],
            slots: 3,
            goodFeedback: 'H-O-H! That’s water (H₂O).',
            badFeedback: 'Not yet — try H-O-H.',
          },
        },
        {
          stableId: 'item_chemistry_molecules_q3',
          title: 'Find the water molecule',
          prompt: 'Which picture is WATER (H₂O)?',
          helperText: 'Look for H-O-H.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.SINGLE_CHOICE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 4,
          points: 1,
          config: {
            options: [
              { key: 'h2o', label: 'H₂O', art: { kind: ART_KINDS.BUILTIN, value: 'molecule-h2o' } },
              { key: 'co2', label: 'CO₂', art: { kind: ART_KINDS.BUILTIN, value: 'molecule-co2' } },
              { key: 'o2', label: 'O₂', art: { kind: ART_KINDS.BUILTIN, value: 'molecule-o2' } },
            ],
            correctOptionKey: 'h2o',
            goodFeedback: 'Water molecule found.',
            badFeedback: 'Look for H-O-H.',
          },
        },
      ],
    },
    {
      stableId: 'subtopic_chemistry_states',
      slug: 'states-of-matter',
      title: 'States of Matter',
      description: 'Heat and cool particles to see solids, liquids, and gas.',
      status: CONTENT_STATUS.PUBLISHED,
      order: 3,
      estimatedMinutes: 4,
      theme: {
        accentColor: '#a78bfa',
        accentColorSoft: '#ddd6fe',
        iconArt: { kind: ART_KINDS.BUILTIN, value: 'states' },
        badgeArt: { kind: ART_KINDS.BUILTIN, value: 'states' },
      },
      reward: {
        label: 'Particle Party Pro',
        description: 'You explored solids, liquids, and gas.',
        stickerArt: { kind: ART_KINDS.BUILTIN, value: 'states' },
      },
      items: [
        {
          stableId: 'item_chemistry_states_scene',
          title: 'Particle Party',
          prompt: 'Particles are always moving.',
          helperText: 'Heat makes them faster. Cool makes them slower.',
          blurb: 'Play with the temperature before the quiz starts.',
          kind: 'activity',
          templateType: TEMPLATE_TYPES.SCENE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 1,
          points: 0,
          config: {
            sceneType: SCENE_TYPES.PARTICLE_PARTY,
            bodyText: 'Watch the particles pack tightly, wiggle, and spread apart.',
            hintText: 'Tap heat and cool to see the difference.',
            completeMessage: 'You made the particles dance!',
          },
        },
        {
          stableId: 'item_chemistry_states_q1',
          title: 'Spot the solid',
          prompt: 'Which box is SOLID?',
          helperText: 'A solid looks packed and tidy.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.SINGLE_CHOICE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 2,
          points: 1,
          config: {
            options: [
              { key: 'solid', label: 'Solid', art: { kind: ART_KINDS.BUILTIN, value: 'solid-box' } },
              { key: 'liquid', label: 'Liquid', art: { kind: ART_KINDS.BUILTIN, value: 'liquid-box' } },
              { key: 'gas', label: 'Gas', art: { kind: ART_KINDS.BUILTIN, value: 'gas-box' } },
            ],
            correctOptionKey: 'solid',
            goodFeedback: 'Correct! Solid = packed and tidy.',
            badFeedback: 'Try again: solid looks packed.',
          },
        },
        {
          stableId: 'item_chemistry_states_q2',
          title: 'Heat it into gas',
          prompt: 'Press HEAT until it becomes GAS!',
          helperText: 'Keep heating until the particles spread out.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.STATE_CHANGE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 3,
          points: 1,
          config: {
            startState: 'solid',
            targetState: 'gas',
            showCoolButton: true,
            goodFeedback: 'Gas unlocked.',
            badFeedback: 'Keep heating!',
          },
        },
        {
          stableId: 'item_chemistry_states_q3',
          title: 'What is ice?',
          prompt: 'Ice is a…',
          helperText: 'Think about hard, packed particles.',
          kind: 'question',
          templateType: TEMPLATE_TYPES.SINGLE_CHOICE,
          status: CONTENT_STATUS.PUBLISHED,
          order: 4,
          points: 1,
          config: {
            options: [
              { key: 'solid', label: 'Solid', art: { kind: ART_KINDS.BUILTIN, value: 'solid-box' } },
              { key: 'liquid', label: 'Liquid', art: { kind: ART_KINDS.BUILTIN, value: 'liquid-box' } },
              { key: 'gas', label: 'Gas', art: { kind: ART_KINDS.BUILTIN, value: 'gas-box' } },
            ],
            correctOptionKey: 'solid',
            goodFeedback: 'Yep! Ice is solid water.',
            badFeedback: 'Try again: ice is hard and packed.',
          },
        },
      ],
    },
  ],
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toPlainObject(doc) {
  if (!doc) {
    return null;
  }
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
}

function sortByTitle(entries) {
  return [...entries].sort((left, right) => String(left.title || '').localeCompare(String(right.title || '')));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAdminDateTime(date) {
  if (!date) {
    return 'No activity yet';
  }
  return ADMIN_DATE_TIME_FORMAT.format(new Date(date));
}

function formatAdminDate(date) {
  if (!date) {
    return '—';
  }
  return ADMIN_DATE_FORMAT.format(new Date(date));
}

function pickLatestDate(...dates) {
  const validDates = dates
    .flat()
    .filter(Boolean)
    .map((entry) => new Date(entry))
    .filter((entry) => Number.isFinite(entry.getTime()));

  if (!validDates.length) {
    return null;
  }

  return validDates.reduce((latest, entry) => (entry > latest ? entry : latest));
}

function pickEarliestDate(...dates) {
  const validDates = dates
    .flat()
    .filter(Boolean)
    .map((entry) => new Date(entry))
    .filter((entry) => Number.isFinite(entry.getTime()));

  if (!validDates.length) {
    return null;
  }

  return validDates.reduce((earliest, entry) => (entry < earliest ? entry : earliest));
}

function compareDateDesc(leftDate, rightDate) {
  const left = leftDate ? new Date(leftDate).getTime() : 0;
  const right = rightDate ? new Date(rightDate).getTime() : 0;
  return right - left;
}

function describeTemplateType(templateType) {
  const option = TEMPLATE_OPTIONS.find((entry) => entry.value === templateType);
  return option ? option.label : normalizeText(templateType, 64, { multiline: false }) || 'Unknown template';
}

function normalizeText(raw, maxLength = 280, { multiline = true } = {}) {
  if (typeof raw !== 'string') {
    return '';
  }

  const normalized = multiline
    ? raw.replace(/\r\n/g, '\n').trim()
    : raw.replace(/\s+/g, ' ').trim();

  return normalized.slice(0, maxLength);
}

function normalizeKey(raw) {
  const value = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return value.slice(0, 80);
}

function normalizeInteger(raw, fallback, min = 0, max = 9999) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function parseCheckbox(raw) {
  return raw === true || raw === 'true' || raw === 'on' || raw === '1' || raw === 1;
}

function slugify(value, fallbackPrefix = 'item') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (normalized) {
    return normalized.slice(0, 120);
  }

  return `${fallbackPrefix}-${crypto.randomBytes(3).toString('hex')}`;
}

function generateStableId(prefix = 'learning') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeStatus(raw) {
  return raw === CONTENT_STATUS.PUBLISHED ? CONTENT_STATUS.PUBLISHED : CONTENT_STATUS.DRAFT;
}

function normalizeTemplateType(raw) {
  const value = normalizeText(raw, 64, { multiline: false });
  if (Object.values(TEMPLATE_TYPES).includes(value)) {
    return value;
  }
  throw createError('Unsupported learning template selected.');
}

function normalizeSceneType(raw) {
  const value = normalizeText(raw, 64, { multiline: false });
  if (Object.values(SCENE_TYPES).includes(value)) {
    return value;
  }
  return SCENE_TYPES.ATOM_PLAY;
}

function normalizeState(raw, fallback = 'solid') {
  const value = normalizeText(raw, 16, { multiline: false }).toLowerCase();
  if (STATE_OPTIONS.some((entry) => entry.value === value)) {
    return value;
  }
  return fallback;
}

function normalizeSafeColor(raw, fallback = '') {
  const value = normalizeText(raw, 48, { multiline: false });
  if (!value) {
    return fallback;
  }

  if (
    /^#([0-9a-f]{3,8})$/i.test(value)
    || /^rgba?\([0-9\s.,%]+\)$/i.test(value)
    || /^hsla?\([0-9\s.,%]+\)$/i.test(value)
  ) {
    return value;
  }

  return fallback;
}

function normalizeSafeUrl(raw) {
  const value = normalizeText(raw, 2048, { multiline: false });
  if (!value) {
    return '';
  }

  if (/^((https?:\/\/)|\/|\.\/)[A-Za-z0-9_./:%?&=+#-]+$/i.test(value)) {
    return value;
  }

  return '';
}

function normalizePattern(raw) {
  const value = normalizeText(raw, 64, { multiline: false });
  if (PATTERN_OPTIONS.some((entry) => entry.value === value)) {
    return value;
  }
  return '';
}

function sanitizeSvgMarkup(rawSvg) {
  const value = String(rawSvg || '').trim().slice(0, 100000);

  if (!value) {
    throw createError('Choose an SVG file or paste SVG markup to add art to the library.');
  }

  if (!/<svg[\s>]/i.test(value)) {
    throw createError('Only SVG artwork can be added to the built-in art library.');
  }

  const cleanSvg = sanitizeHtml(value, {
    allowedTags: [
      'svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon',
      'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
      'text', 'tspan', 'title', 'desc', 'symbol',
    ],
    allowedAttributes: {
      '*': [
        'id', 'class', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
        'stroke-miterlimit', 'stroke-dasharray', 'opacity', 'transform', 'style',
        'fill-rule', 'clip-rule', 'vector-effect', 'mask', 'clip-path', 'filter',
      ],
      svg: ['xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'role', 'aria-hidden', 'focusable', 'preserveAspectRatio'],
      path: ['d', 'pathLength'],
      circle: ['cx', 'cy', 'r'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
      ellipse: ['cx', 'cy', 'rx', 'ry'],
      line: ['x1', 'y1', 'x2', 'y2'],
      polyline: ['points'],
      polygon: ['points'],
      linearGradient: ['x1', 'x2', 'y1', 'y2', 'gradientUnits', 'gradientTransform'],
      radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform'],
      stop: ['offset', 'stop-color', 'stop-opacity'],
      clipPath: ['clipPathUnits'],
      mask: ['maskUnits', 'maskContentUnits', 'x', 'y', 'width', 'height'],
      pattern: ['x', 'y', 'width', 'height', 'patternUnits', 'patternContentUnits', 'patternTransform'],
      text: ['x', 'y', 'dx', 'dy', 'text-anchor', 'font-size', 'font-family', 'font-weight', 'letter-spacing'],
      tspan: ['x', 'y', 'dx', 'dy', 'text-anchor', 'font-size', 'font-family', 'font-weight', 'letter-spacing'],
      symbol: ['viewBox', 'preserveAspectRatio'],
    },
    parser: {
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  }).trim();

  if (!cleanSvg || !/^<svg[\s>]/i.test(cleanSvg)) {
    throw createError('SVG upload did not contain a valid <svg> element.');
  }

  return cleanSvg;
}

function normalizeArt(kindRaw, valueRaw, fallback = null) {
  const kind = Object.values(ART_KINDS).includes(kindRaw) ? kindRaw : ART_KINDS.EMOJI;
  const value = normalizeText(valueRaw, kind === ART_KINDS.IMAGE ? 2048 : 80, { multiline: false });

  if (!value) {
    return fallback ? { ...fallback } : { kind: ART_KINDS.EMOJI, value: '' };
  }

  if (kind === ART_KINDS.IMAGE) {
    const safeUrl = normalizeSafeUrl(value);
    if (!safeUrl) {
      return fallback ? { ...fallback } : { kind: ART_KINDS.EMOJI, value: '' };
    }
    return { kind, value: safeUrl };
  }

  if (kind === ART_KINDS.BUILTIN) {
    const safeValue = slugify(value, 'art');
    return { kind, value: safeValue };
  }

  return { kind, value: value.slice(0, 16) };
}

function mergeArt(base, override) {
  if (override && override.value) {
    return { kind: override.kind || ART_KINDS.EMOJI, value: override.value };
  }
  return base ? { kind: base.kind || ART_KINDS.EMOJI, value: base.value || '' } : { kind: ART_KINDS.EMOJI, value: '' };
}

function resolveTheme(topicTheme = {}, subtopicTheme = {}) {
  const mergedTopic = {
    ...DEFAULT_THEME,
    ...topicTheme,
    iconArt: mergeArt(DEFAULT_THEME.iconArt, topicTheme.iconArt),
    mascotArt: mergeArt(DEFAULT_THEME.mascotArt, topicTheme.mascotArt),
    badgeArt: mergeArt(DEFAULT_THEME.badgeArt, topicTheme.badgeArt),
  };

  return {
    ...mergedTopic,
    ...subtopicTheme,
    iconArt: mergeArt(mergedTopic.iconArt, subtopicTheme.iconArt),
    mascotArt: mergeArt(mergedTopic.mascotArt, subtopicTheme.mascotArt),
    badgeArt: mergeArt(mergedTopic.badgeArt, subtopicTheme.badgeArt),
  };
}

function buildThemeStyleAttribute(theme = DEFAULT_THEME) {
  const backgroundImage = theme.backgroundImageUrl ? `url(${theme.backgroundImageUrl})` : 'none';
  const variables = {
    '--accent': theme.accentColor || DEFAULT_THEME.accentColor,
    '--accentSoft': theme.accentColorSoft || DEFAULT_THEME.accentColorSoft,
    '--bgA': theme.backgroundStart || DEFAULT_THEME.backgroundStart,
    '--bgB': theme.backgroundEnd || DEFAULT_THEME.backgroundEnd,
    '--glow': theme.glowColor || DEFAULT_THEME.glowColor,
    '--bgImage': backgroundImage,
  };

  return Object.entries(variables)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

function getArtText(art) {
  if (!art) {
    return '✨';
  }

  if (art.kind === ART_KINDS.EMOJI) {
    return art.value || '✨';
  }

  if (art.kind === ART_KINDS.IMAGE) {
    return CUSTOM_ART_PLACEHOLDER;
  }

  return BUILTIN_ART_FALLBACKS[art.value] || CUSTOM_ART_PLACEHOLDER;
}

function renderArtMarkup(art, uploadedBuiltinArtMap = {}) {
  if (!art || !art.value) {
    return '<span class="learning-icon-text">✨</span>';
  }

  if (art.kind === ART_KINDS.EMOJI) {
    return `<span class="learning-icon-text">${escapeHtml(art.value)}</span>`;
  }

  if (art.kind === ART_KINDS.IMAGE) {
    return `<img src="${escapeHtml(art.value)}" alt="" loading="lazy">`;
  }

  if (uploadedBuiltinArtMap[art.value]) {
    return uploadedBuiltinArtMap[art.value];
  }

  const previewText = BUILTIN_ART_FALLBACKS[art.value] || CUSTOM_ART_PLACEHOLDER;
  return `<span class="learning-icon-text">${escapeHtml(previewText)}</span>`;
}

async function loadLearningArtAssets() {
  return sortByTitle((await LearningArtAsset.find({})).map((asset) => toPlainObject(asset)));
}

function buildUploadedBuiltinArtMap(artAssets = []) {
  return artAssets.reduce((map, asset) => {
    if (asset?.key && asset?.svgMarkup) {
      map[asset.key] = asset.svgMarkup;
    }
    return map;
  }, {});
}

function buildUploadedBuiltinArtChoices(artAssets = []) {
  return artAssets.map((asset) => ({
    _id: String(asset._id),
    stableId: asset.stableId,
    key: asset.key,
    title: asset.title,
    description: asset.description || '',
    previewText: CUSTOM_ART_PLACEHOLDER,
    previewHtml: asset.svgMarkup,
    source: asset.source || 'upload',
    createdBy: asset.createdBy || '',
    createdAt: asset.createdAt || null,
    createdAtDisplay: formatAdminDateTime(asset.createdAt),
    updatedAtDisplay: formatAdminDateTime(asset.updatedAt),
  }));
}

function getSystemBuiltinArtChoices() {
  return SYSTEM_BUILTIN_ART_CHOICES.map((entry) => ({ ...entry }));
}

function withPreview(path, preview) {
  if (!preview) {
    return path;
  }
  return `${path}${path.includes('?') ? '&' : '?'}preview=1`;
}

function buildVisibilityFilter(preview = false) {
  if (preview) {
    return {};
  }
  return { status: CONTENT_STATUS.PUBLISHED };
}

function computeItemStarValue(item) {
  if (!item || item.kind !== 'question') {
    return 0;
  }
  return clamp(Number(item.points) || 0, 0, 10);
}

function sortByOrderThenTitle(entries) {
  return [...entries].sort((left, right) => {
    const orderDelta = (left.order || 0) - (right.order || 0);
    if (orderDelta !== 0) {
      return orderDelta;
    }
    return String(left.title || '').localeCompare(String(right.title || ''));
  });
}

function normalizeStringList(raw, maxItems = 12, maxLength = 24) {
  return String(raw || '')
    .split(/[\n,]/)
    .map((entry) => normalizeText(entry, maxLength, { multiline: false }))
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildChoiceOptionsFromForm(body) {
  const options = [];

  for (let index = 1; index <= 4; index += 1) {
    const label = normalizeText(body[`choiceOption${index}Label`], 80, { multiline: false });
    const rawKey = normalizeText(body[`choiceOption${index}Key`], 80, { multiline: false });
    const art = normalizeArt(
      body[`choiceOption${index}ArtKind`],
      body[`choiceOption${index}ArtValue`],
      { kind: ART_KINDS.EMOJI, value: '✨' }
    );

    if (!label) {
      continue;
    }

    options.push({
      key: normalizeKey(rawKey || label) || slugify(label, 'option'),
      label,
      art,
    });
  }

  return options;
}

function buildThemePatchFromForm(body, prefix) {
  return {
    accentColor: normalizeSafeColor(body[`${prefix}AccentColor`]),
    accentColorSoft: normalizeSafeColor(body[`${prefix}AccentColorSoft`]),
    backgroundStart: normalizeSafeColor(body[`${prefix}BackgroundStart`]),
    backgroundEnd: normalizeSafeColor(body[`${prefix}BackgroundEnd`]),
    glowColor: normalizeSafeColor(body[`${prefix}GlowColor`]),
    backgroundImageUrl: normalizeSafeUrl(body[`${prefix}BackgroundImageUrl`]),
    pattern: normalizePattern(body[`${prefix}Pattern`]),
    iconArt: normalizeArt(body[`${prefix}IconArtKind`], body[`${prefix}IconArtValue`], DEFAULT_THEME.iconArt),
    mascotArt: normalizeArt(body[`${prefix}MascotArtKind`], body[`${prefix}MascotArtValue`], DEFAULT_THEME.mascotArt),
    badgeArt: normalizeArt(body[`${prefix}BadgeArtKind`], body[`${prefix}BadgeArtValue`], DEFAULT_THEME.badgeArt),
  };
}

function buildRewardPatchFromForm(body, prefix, fallbackLabel = 'Sticker') {
  return {
    label: normalizeText(body[`${prefix}RewardLabel`], 120, { multiline: false }) || fallbackLabel,
    description: normalizeText(body[`${prefix}RewardDescription`], 280),
    stickerArt: normalizeArt(body[`${prefix}RewardArtKind`], body[`${prefix}RewardArtValue`], DEFAULT_REWARD.stickerArt),
  };
}

function buildSceneConfigFromForm(body) {
  return {
    sceneType: normalizeSceneType(body.sceneType),
    bodyText: normalizeText(body.sceneBodyText, 280),
    hintText: normalizeText(body.sceneHintText, 220),
    exampleText: normalizeText(body.sceneExampleText, 220),
    pieces: normalizeStringList(body.scenePieces, 12, 8),
    slotCount: normalizeInteger(body.sceneSlotCount, 3, 2, 6),
    completeMessage: normalizeText(body.goodFeedback, 180) || 'Nice exploring!',
  };
}

function buildSingleChoiceConfigFromForm(body) {
  const options = buildChoiceOptionsFromForm(body);
  if (options.length < 2) {
    throw createError('Single-choice items need at least two options.');
  }

  const correctOptionKey = slugify(body.correctOptionKey || '', 'option');
  if (!normalizeKey(body.correctOptionKey || '')) {
    throw createError('Choose a correct option key that matches one of the option rows.');
  }
  const safeCorrectOptionKey = normalizeKey(body.correctOptionKey || '');
  if (!options.some((option) => option.key === safeCorrectOptionKey)) {
    throw createError('Choose a correct option key that matches one of the option rows.');
  }

  return {
    options,
    correctOptionKey: safeCorrectOptionKey,
    goodFeedback: normalizeText(body.goodFeedback, 180) || 'Correct!',
    badFeedback: normalizeText(body.badFeedback, 180) || 'Try again!',
  };
}

function buildCountTargetConfigFromForm(body) {
  return {
    target: normalizeInteger(body.targetCount, 1, 0, 30),
    max: normalizeInteger(body.maxCount, 8, 1, 40),
    counterLabel: normalizeText(body.counterLabel, 40, { multiline: false }) || 'Count',
    goodFeedback: normalizeText(body.goodFeedback, 180) || 'Nice counting!',
    badFeedback: normalizeText(body.badFeedback, 180) || 'Try again!',
  };
}

function buildBuilderSequenceConfigFromForm(body) {
  const pieces = normalizeStringList(body.builderPieces, 12, 8);
  const targetSequence = normalizeStringList(body.builderTargetSequence, 12, 8);
  const slots = normalizeInteger(body.builderSlotCount, targetSequence.length || 3, 2, 6);

  if (!targetSequence.length) {
    throw createError('Builder items need a target sequence.');
  }

  return {
    pieces: pieces.length ? pieces : [...targetSequence],
    targetSequence,
    slots,
    goodFeedback: normalizeText(body.goodFeedback, 180) || 'Perfect!',
    badFeedback: normalizeText(body.badFeedback, 180) || 'Try again!',
  };
}

function buildStateChangeConfigFromForm(body) {
  return {
    startState: normalizeState(body.startState, 'solid'),
    targetState: normalizeState(body.targetState, 'gas'),
    showCoolButton: parseCheckbox(body.showCoolButton),
    goodFeedback: normalizeText(body.goodFeedback, 180) || 'Great job!',
    badFeedback: normalizeText(body.badFeedback, 180) || 'Keep going!',
  };
}

function buildItemConfigFromForm(body, templateType) {
  if (templateType === TEMPLATE_TYPES.SCENE) {
    return buildSceneConfigFromForm(body);
  }
  if (templateType === TEMPLATE_TYPES.SINGLE_CHOICE) {
    return buildSingleChoiceConfigFromForm(body);
  }
  if (templateType === TEMPLATE_TYPES.COUNT_TARGET) {
    return buildCountTargetConfigFromForm(body);
  }
  if (templateType === TEMPLATE_TYPES.BUILDER_SEQUENCE) {
    return buildBuilderSequenceConfigFromForm(body);
  }
  if (templateType === TEMPLATE_TYPES.STATE_CHANGE) {
    return buildStateChangeConfigFromForm(body);
  }

  throw createError('Unsupported learning template selected.');
}

async function ensureUniqueFieldValue(Model, fieldName, baseValue, fallbackPrefix = 'entry', extraFilter = {}, excludeId = null) {
  const base = slugify(baseValue, fallbackPrefix);
  let candidate = base;
  let suffix = 2;

  while (true) {
    const filter = { ...extraFilter, [fieldName]: candidate };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const existing = await Model.exists(filter);
    if (!existing) {
      return candidate;
    }

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

async function ensureUniqueSlug(Model, baseSlug, extraFilter = {}, excludeId = null) {
  return ensureUniqueFieldValue(Model, 'slug', baseSlug, 'entry', extraFilter, excludeId);
}

function buildProgressSummary(progressDoc, items, subtopic) {
  const stateMap = new Map((progressDoc?.itemStates || []).map((state) => [state.itemStableId, state]));
  const itemStates = items.map((item) => {
    const state = stateMap.get(item.stableId) || {};
    return {
      itemStableId: item.stableId,
      completed: !!state.completed,
      attempts: Number(state.attempts) || 0,
      correctAttempts: Number(state.correctAttempts) || 0,
      starsEarned: Number(state.starsEarned) || 0,
      status: state.status || 'not_started',
      lastResult: state.lastResult || 'none',
    };
  });

  const totalItems = items.length;
  const completedItems = itemStates.filter((entry) => entry.completed).length;
  const maxStars = items.reduce((sum, item) => sum + computeItemStarValue(item), 0);
  const totalStars = itemStates.reduce((sum, entry) => sum + (entry.starsEarned || 0), 0);
  const nextIncompleteIndex = itemStates.findIndex((entry) => !entry.completed);
  const currentItemIndex = nextIncompleteIndex >= 0 ? nextIncompleteIndex : totalItems;
  const completed = totalItems > 0 && completedItems === totalItems;

  return {
    status: completed ? 'completed' : completedItems > 0 ? 'in_progress' : 'not_started',
    totalItems,
    completedItems,
    totalStars,
    maxStars,
    percentComplete: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
    completed,
    currentItemIndex,
    currentItemStableId: items[currentItemIndex] ? items[currentItemIndex].stableId : '',
    stickerUnlocked: completed || !!progressDoc?.stickerUnlocked,
    stickerLabel: subtopic?.reward?.label || progressDoc?.stickerLabel || DEFAULT_REWARD.label,
    itemStates,
  };
}

function syncProgressDocument(progressDoc, items, subtopic) {
  let changed = false;
  const existingMap = new Map((progressDoc.itemStates || []).map((state) => [state.itemStableId, state]));
  const nextStates = [];

  items.forEach((item) => {
    let state = existingMap.get(item.stableId);
    if (!state) {
      state = {
        itemId: item._id,
        itemStableId: item.stableId,
        templateType: item.templateType,
        status: 'not_started',
        attempts: 0,
        correctAttempts: 0,
        completed: false,
        starsEarned: 0,
        firstCompletedAt: null,
        lastCompletedAt: null,
        lastAttemptAt: null,
        lastResult: 'none',
        lastAnswer: null,
      };
      changed = true;
    } else {
      if (String(state.itemId) !== String(item._id)) {
        state.itemId = item._id;
        changed = true;
      }
      if (state.templateType !== item.templateType) {
        state.templateType = item.templateType;
        changed = true;
      }
    }
    nextStates.push(state);
  });

  if ((progressDoc.itemStates || []).length !== nextStates.length) {
    progressDoc.itemStates = nextStates;
    changed = true;
  } else {
    progressDoc.itemStates = nextStates;
  }

  const summary = buildProgressSummary(progressDoc, items, subtopic);
  const stickerLabel = subtopic?.reward?.label || DEFAULT_REWARD.label;

  if (progressDoc.status !== summary.status) {
    progressDoc.status = summary.status;
    changed = true;
  }
  if (progressDoc.currentItemIndex !== summary.currentItemIndex) {
    progressDoc.currentItemIndex = summary.currentItemIndex;
    changed = true;
  }
  if (progressDoc.currentItemStableId !== summary.currentItemStableId) {
    progressDoc.currentItemStableId = summary.currentItemStableId;
    changed = true;
  }
  if (progressDoc.totalStars !== summary.totalStars) {
    progressDoc.totalStars = summary.totalStars;
    changed = true;
  }
  if (progressDoc.maxStars !== summary.maxStars) {
    progressDoc.maxStars = summary.maxStars;
    changed = true;
  }
  if (progressDoc.stickerUnlocked !== summary.stickerUnlocked) {
    progressDoc.stickerUnlocked = summary.stickerUnlocked;
    changed = true;
  }
  if (progressDoc.stickerLabel !== stickerLabel) {
    progressDoc.stickerLabel = stickerLabel;
    changed = true;
  }
  if (summary.completed) {
    if (!progressDoc.completedAt) {
      progressDoc.completedAt = new Date();
      changed = true;
    }
  } else if (progressDoc.completedAt) {
    progressDoc.completedAt = null;
    changed = true;
  }

  return changed;
}

function sanitizeArtPayload(art, fallback = { kind: ART_KINDS.EMOJI, value: '✨' }) {
  return normalizeArt(art?.kind, art?.value, fallback);
}

function sanitizePublicItem(itemDoc) {
  const item = typeof itemDoc.toObject === 'function' ? itemDoc.toObject() : itemDoc;
  const config = item.config || {};

  const base = {
    stableId: item.stableId,
    title: item.title,
    prompt: item.prompt,
    helperText: item.helperText,
    blurb: item.blurb,
    kind: item.kind,
    templateType: item.templateType,
    order: item.order,
    points: computeItemStarValue(item),
    config: {},
  };

  if (item.templateType === TEMPLATE_TYPES.SCENE) {
    base.config = {
      sceneType: normalizeSceneType(config.sceneType),
      bodyText: normalizeText(config.bodyText, 280),
      hintText: normalizeText(config.hintText, 220),
      exampleText: normalizeText(config.exampleText, 220),
      pieces: Array.isArray(config.pieces) ? config.pieces.slice(0, 12) : [],
      slotCount: normalizeInteger(config.slotCount, 3, 2, 6),
    };
    return base;
  }

  if (item.templateType === TEMPLATE_TYPES.SINGLE_CHOICE) {
    base.config = {
      options: Array.isArray(config.options)
        ? config.options.map((option) => ({
            key: slugify(option.key || option.label || '', 'option'),
            label: normalizeText(option.label, 80, { multiline: false }),
            art: sanitizeArtPayload(option.art, { kind: ART_KINDS.EMOJI, value: '✨' }),
          }))
        : [],
    };
    return base;
  }

  if (item.templateType === TEMPLATE_TYPES.COUNT_TARGET) {
    base.config = {
      max: normalizeInteger(config.max, 8, 1, 40),
      counterLabel: normalizeText(config.counterLabel, 40, { multiline: false }) || 'Count',
    };
    return base;
  }

  if (item.templateType === TEMPLATE_TYPES.BUILDER_SEQUENCE) {
    base.config = {
      pieces: Array.isArray(config.pieces) ? config.pieces.slice(0, 12) : [],
      slots: normalizeInteger(config.slots, Array.isArray(config.targetSequence) ? config.targetSequence.length : 3, 2, 6),
    };
    return base;
  }

  if (item.templateType === TEMPLATE_TYPES.STATE_CHANGE) {
    base.config = {
      startState: normalizeState(config.startState, 'solid'),
      showCoolButton: config.showCoolButton !== false,
    };
    return base;
  }

  return base;
}

function evaluateItemAnswer(itemDoc, payload = {}) {
  const item = typeof itemDoc.toObject === 'function' ? itemDoc.toObject() : itemDoc;
  const config = item.config || {};
  const body = payload && typeof payload === 'object' ? payload : {};

  if (item.templateType === TEMPLATE_TYPES.SCENE) {
    return {
      accepted: true,
      correct: null,
      completed: true,
      normalizedAnswer: { action: 'complete' },
      feedbackMessage: normalizeText(config.completeMessage, 180) || 'Nice exploring!',
      attemptType: 'activity',
    };
  }

  if (item.templateType === TEMPLATE_TYPES.SINGLE_CHOICE) {
    if (!normalizeKey(body.optionKey || body.answer?.optionKey || '')) {
      throw createError('Please choose an answer.');
    }
    const optionKey = normalizeKey(body.optionKey || body.answer?.optionKey || '');

    const correct = optionKey === normalizeKey(config.correctOptionKey || '');
    return {
      accepted: true,
      correct,
      completed: correct,
      normalizedAnswer: { optionKey },
      feedbackMessage: correct
        ? normalizeText(config.goodFeedback, 180) || 'Correct!'
        : normalizeText(config.badFeedback, 180) || 'Try again!',
      attemptType: 'answer',
    };
  }

  if (item.templateType === TEMPLATE_TYPES.COUNT_TARGET) {
    const count = Number.parseInt(body.count ?? body.answer?.count, 10);
    if (!Number.isFinite(count)) {
      throw createError('Please set a count before checking.');
    }

    const correct = count === Number(config.target);
    return {
      accepted: true,
      correct,
      completed: correct,
      normalizedAnswer: { count },
      feedbackMessage: correct
        ? normalizeText(config.goodFeedback, 180) || 'Nice counting!'
        : normalizeText(config.badFeedback, 180) || 'Try again!',
      attemptType: 'answer',
    };
  }

  if (item.templateType === TEMPLATE_TYPES.BUILDER_SEQUENCE) {
    const sequenceRaw = Array.isArray(body.sequence)
      ? body.sequence
      : Array.isArray(body.answer?.sequence)
        ? body.answer.sequence
        : [];
    const sequence = sequenceRaw
      .map((entry) => normalizeText(entry, 8, { multiline: false }))
      .filter(Boolean);
    const targetSequence = Array.isArray(config.targetSequence) ? config.targetSequence : [];

    if (!sequence.length) {
      throw createError('Please build something before checking.');
    }

    const correct = sequence.length === targetSequence.length
      && targetSequence.every((entry, index) => entry === sequence[index]);

    return {
      accepted: true,
      correct,
      completed: correct,
      normalizedAnswer: { sequence },
      feedbackMessage: correct
        ? normalizeText(config.goodFeedback, 180) || 'Perfect!'
        : normalizeText(config.badFeedback, 180) || 'Try again!',
      attemptType: 'answer',
    };
  }

  if (item.templateType === TEMPLATE_TYPES.STATE_CHANGE) {
    const state = normalizeState(body.state ?? body.answer?.state, '');
    if (!state) {
      throw createError('Please change the state first.');
    }

    const correct = state === normalizeState(config.targetState, 'gas');
    return {
      accepted: true,
      correct,
      completed: correct,
      normalizedAnswer: { state },
      feedbackMessage: correct
        ? normalizeText(config.goodFeedback, 180) || 'Great job!'
        : normalizeText(config.badFeedback, 180) || 'Keep going!',
      attemptType: 'answer',
    };
  }

  throw createError('Unsupported learning item type.', 400);
}

function buildProgressDocument(user, topic, subtopic, items, existingProgress = null) {
  const progress = existingProgress || new LearningProgress({
    userId: user._id,
    userName: user.name,
    topicId: topic._id,
    topicStableId: topic.stableId,
    topicSlug: topic.slug,
    subtopicId: subtopic._id,
    subtopicStableId: subtopic.stableId,
    subtopicSlug: subtopic.slug,
    status: 'not_started',
    currentItemIndex: 0,
    currentItemStableId: items[0] ? items[0].stableId : '',
    totalStars: 0,
    maxStars: 0,
    stickerUnlocked: false,
    stickerLabel: subtopic.reward?.label || DEFAULT_REWARD.label,
    startedAt: new Date(),
    lastPlayedAt: new Date(),
    itemStates: [],
  });

  progress.userName = user.name;
  progress.topicId = topic._id;
  progress.topicStableId = topic.stableId;
  progress.topicSlug = topic.slug;
  progress.subtopicId = subtopic._id;
  progress.subtopicStableId = subtopic.stableId;
  progress.subtopicSlug = subtopic.slug;
  progress.lastPlayedAt = new Date();

  if (!progress.startedAt) {
    progress.startedAt = new Date();
  }

  syncProgressDocument(progress, items, subtopic);
  return progress;
}

async function ensureProgressDocument(user, topic, subtopic, items, { persist = true } = {}) {
  const existingProgress = await LearningProgress.findOne({
    userId: user._id,
    subtopicId: subtopic._id,
  });
  const progress = buildProgressDocument(user, topic, subtopic, items, existingProgress);

  if (persist) {
    await progress.save();
  }

  return progress;
}

async function recordAttempt(user, topic, subtopic, item, evaluation, starsAwarded) {
  try {
    await LearningAttempt.create({
      userId: user._id,
      userName: user.name,
      topicId: topic._id,
      topicStableId: topic.stableId,
      subtopicId: subtopic._id,
      subtopicStableId: subtopic.stableId,
      itemId: item._id,
      itemStableId: item.stableId,
      templateType: item.templateType,
      attemptType: evaluation.attemptType,
      answer: evaluation.normalizedAnswer,
      isCorrect: evaluation.correct,
      completed: !!evaluation.completed,
      starsAwarded,
      feedbackMessage: evaluation.feedbackMessage,
    });
  } catch (error) {
    logger.warning('Unable to store learning attempt history', {
      category: 'learning',
      metadata: {
        userId: String(user._id),
        itemStableId: item.stableId,
        error: error.message,
      },
    });
  }
}

function decorateSubtopicSummary(topic, subtopic, items, progressDoc, preview = false, uploadedBuiltinArtMap = {}) {
  const resolvedTheme = resolveTheme(topic.theme || {}, subtopic.theme || {});
  const progress = buildProgressSummary(progressDoc, items, subtopic);
  const rewardArt = subtopic.reward?.stickerArt || DEFAULT_REWARD.stickerArt;

  return {
    _id: String(subtopic._id),
    stableId: subtopic.stableId,
    slug: subtopic.slug,
    title: subtopic.title,
    description: subtopic.description,
    status: subtopic.status,
    order: subtopic.order,
    estimatedMinutes: subtopic.estimatedMinutes,
    theme: resolvedTheme,
    themeStyle: buildThemeStyleAttribute(resolvedTheme),
    iconText: getArtText(resolvedTheme.iconArt),
    iconMarkup: renderArtMarkup(resolvedTheme.iconArt, uploadedBuiltinArtMap),
    rewardLabel: subtopic.reward?.label || DEFAULT_REWARD.label,
    rewardText: getArtText(rewardArt),
    rewardMarkup: renderArtMarkup(rewardArt, uploadedBuiltinArtMap),
    rewardDescription: subtopic.reward?.description || '',
    path: withPreview(`/learning/topic/${topic.slug}/${subtopic.slug}`, preview),
    previewPath: withPreview(`/learning/topic/${topic.slug}/${subtopic.slug}`, true),
    totalItems: progress.totalItems,
    completedItems: progress.completedItems,
    totalStars: progress.totalStars,
    maxStars: progress.maxStars,
    percentComplete: progress.percentComplete,
    completed: progress.completed,
    stickerUnlocked: progress.stickerUnlocked,
    actionLabel: progress.completed ? 'Replay' : progress.completedItems > 0 ? 'Continue' : 'Start',
    progress,
  };
}

function decorateTopicSummary(topic, subtopics, preview = false, uploadedBuiltinArtMap = {}) {
  const resolvedTheme = resolveTheme(topic.theme || {}, {});
  const totalStars = subtopics.reduce((sum, subtopic) => sum + subtopic.totalStars, 0);
  const maxStars = subtopics.reduce((sum, subtopic) => sum + subtopic.maxStars, 0);
  const stickerCount = subtopics.filter((subtopic) => subtopic.stickerUnlocked).length;
  const nextSubtopic = subtopics.find((subtopic) => !subtopic.completed) || subtopics[0] || null;

  return {
    _id: String(topic._id),
    stableId: topic.stableId,
    slug: topic.slug,
    title: topic.title,
    shortLabel: topic.shortLabel,
    description: topic.description,
    status: topic.status,
    order: topic.order,
    theme: resolvedTheme,
    themeStyle: buildThemeStyleAttribute(resolvedTheme),
    iconText: getArtText(resolvedTheme.iconArt),
    iconMarkup: renderArtMarkup(resolvedTheme.iconArt, uploadedBuiltinArtMap),
    badgeText: getArtText(resolvedTheme.badgeArt),
    badgeMarkup: renderArtMarkup(resolvedTheme.badgeArt, uploadedBuiltinArtMap),
    subtopicCount: subtopics.length,
    totalStars,
    maxStars,
    stickerCount,
    path: withPreview(`/learning/topic/${topic.slug}`, preview),
    continuePath: nextSubtopic ? nextSubtopic.path : withPreview(`/learning/topic/${topic.slug}`, preview),
    previewPath: withPreview(`/learning/topic/${topic.slug}`, true),
    actionLabel: totalStars > 0 ? 'Continue topic' : 'Open topic',
    subtopics,
  };
}

async function loadTopicTreeForUser(user, { preview = false } = {}) {
  const visibilityFilter = buildVisibilityFilter(preview);
  const topics = sortByOrderThenTitle(await LearningTopic.find(visibilityFilter).lean());
  const artAssets = await loadLearningArtAssets();
  const uploadedBuiltinArtMap = buildUploadedBuiltinArtMap(artAssets);

  if (!topics.length) {
    return [];
  }

  const topicIds = topics.map((topic) => topic._id);
  const subtopics = sortByOrderThenTitle(await LearningSubtopic.find({
    ...visibilityFilter,
    topicId: { $in: topicIds },
  }).lean());
  const subtopicIds = subtopics.map((subtopic) => subtopic._id);

  const items = sortByOrderThenTitle(await LearningItem.find({
    ...visibilityFilter,
    subtopicId: { $in: subtopicIds },
  }).lean());

  const progressDocs = subtopicIds.length > 0
    ? await LearningProgress.find({
        userId: user._id,
        subtopicId: { $in: subtopicIds },
      }).lean()
    : [];

  const itemsBySubtopic = new Map();
  items.forEach((item) => {
    const key = String(item.subtopicId);
    if (!itemsBySubtopic.has(key)) {
      itemsBySubtopic.set(key, []);
    }
    itemsBySubtopic.get(key).push(item);
  });

  const progressBySubtopic = new Map(progressDocs.map((progressDoc) => [String(progressDoc.subtopicId), progressDoc]));
  const subtopicsByTopic = new Map();

  subtopics.forEach((subtopic) => {
    const topic = topics.find((entry) => String(entry._id) === String(subtopic.topicId));
    if (!topic) {
      return;
    }

    const decorated = decorateSubtopicSummary(
      topic,
      subtopic,
      itemsBySubtopic.get(String(subtopic._id)) || [],
      progressBySubtopic.get(String(subtopic._id)) || null,
      preview,
      uploadedBuiltinArtMap
    );

    const key = String(topic._id);
    if (!subtopicsByTopic.has(key)) {
      subtopicsByTopic.set(key, []);
    }
    subtopicsByTopic.get(key).push(decorated);
  });

  return topics.map((topic) => decorateTopicSummary(
    topic,
    sortByOrderThenTitle(subtopicsByTopic.get(String(topic._id)) || []),
    preview,
    uploadedBuiltinArtMap
  ));
}

async function getHomePageData(user, { preview = false } = {}) {
  const topics = await loadTopicTreeForUser(user, { preview });
  const totals = topics.reduce((accumulator, topic) => {
    accumulator.topicCount += 1;
    accumulator.subtopicCount += topic.subtopicCount;
    accumulator.totalStars += topic.totalStars;
    accumulator.maxStars += topic.maxStars;
    accumulator.stickerCount += topic.stickerCount;
    return accumulator;
  }, {
    topicCount: 0,
    subtopicCount: 0,
    totalStars: 0,
    maxStars: 0,
    stickerCount: 0,
  });

  return {
    theme: DEFAULT_THEME,
    themeStyle: buildThemeStyleAttribute(DEFAULT_THEME),
    topics,
    totals,
  };
}

async function getTopicPageData(user, topicSlug, { preview = false } = {}) {
  const topics = await loadTopicTreeForUser(user, { preview });
  return topics.find((topic) => topic.slug === topicSlug) || null;
}

async function getSubtopicPlayerData(user, topicSlug, subtopicSlug, { preview = false } = {}) {
  const visibilityFilter = buildVisibilityFilter(preview);
  const topic = await LearningTopic.findOne({ slug: topicSlug, ...visibilityFilter });
  if (!topic) {
    return null;
  }

  const subtopic = await LearningSubtopic.findOne({
    topicId: topic._id,
    slug: subtopicSlug,
    ...visibilityFilter,
  });
  if (!subtopic) {
    return null;
  }

  const items = sortByOrderThenTitle(await LearningItem.find({
    subtopicId: subtopic._id,
    ...visibilityFilter,
  }));
  const artAssets = await loadLearningArtAssets();
  const uploadedBuiltinArtMap = buildUploadedBuiltinArtMap(artAssets);

  const progressDoc = await ensureProgressDocument(user, topic, subtopic, items, { persist: !preview });
  const progress = buildProgressSummary(progressDoc, items, subtopic);
  const resolvedTheme = resolveTheme(topic.theme || {}, subtopic.theme || {});

  return {
    topic: {
      stableId: topic.stableId,
      slug: topic.slug,
      title: topic.title,
      shortLabel: topic.shortLabel,
      description: topic.description,
    },
    subtopic: {
      stableId: subtopic.stableId,
      slug: subtopic.slug,
      title: subtopic.title,
      description: subtopic.description,
      rewardLabel: subtopic.reward?.label || DEFAULT_REWARD.label,
      rewardText: getArtText(subtopic.reward?.stickerArt || DEFAULT_REWARD.stickerArt),
      estimatedMinutes: subtopic.estimatedMinutes,
    },
    theme: resolvedTheme,
    themeStyle: buildThemeStyleAttribute(resolvedTheme),
    iconText: getArtText(resolvedTheme.iconArt),
    items: items.map((item) => sanitizePublicItem(item)),
    progress,
    paths: {
      home: '/learning',
      topic: withPreview(`/learning/topic/${topic.slug}`, preview),
      restart: withPreview(`/learning/api/subtopics/${subtopic.stableId}/reset`, preview),
      submitBase: `/learning/api/subtopics/${subtopic.stableId}/items`,
      submitPreviewQuery: preview ? '?preview=1' : '',
    },
    builtinArtMap: uploadedBuiltinArtMap,
    preview,
  };
}

async function submitItemResponse({ user, subtopicStableId, itemStableId, payload = {}, preview = false }) {
  const visibilityFilter = buildVisibilityFilter(preview);
  const subtopic = await LearningSubtopic.findOne({ stableId: subtopicStableId, ...visibilityFilter });
  if (!subtopic) {
    throw createError('Learning subtopic not found.', 404);
  }

  const topic = await LearningTopic.findById(subtopic.topicId);
  if (!topic) {
    throw createError('Learning topic not found.', 404);
  }

  const item = await LearningItem.findOne({
    subtopicId: subtopic._id,
    stableId: itemStableId,
    ...visibilityFilter,
  });
  if (!item) {
    throw createError('Learning item not found.', 404);
  }

  const items = sortByOrderThenTitle(await LearningItem.find({
    subtopicId: subtopic._id,
    ...visibilityFilter,
  }));

  const progress = await ensureProgressDocument(user, topic, subtopic, items, { persist: !preview });
  const evaluation = evaluateItemAnswer(item, payload);
  const itemState = progress.itemStates.find((entry) => entry.itemStableId === item.stableId);
  const now = new Date();

  if (!itemState) {
    throw createError('Unable to locate progress state for this item.', 500);
  }

  itemState.attempts += 1;
  itemState.lastAttemptAt = now;
  itemState.lastAnswer = evaluation.normalizedAnswer;
  itemState.status = 'in_progress';

  let starsAwarded = 0;
  if (evaluation.correct === true || evaluation.completed === true) {
    if (evaluation.correct === true) {
      itemState.correctAttempts += 1;
      itemState.lastResult = 'correct';
    } else {
      itemState.lastResult = 'completed';
    }

    if (!itemState.completed) {
      itemState.completed = true;
      itemState.firstCompletedAt = itemState.firstCompletedAt || now;
      starsAwarded = computeItemStarValue(item);
      itemState.starsEarned = starsAwarded;
    }

    itemState.lastCompletedAt = now;
    itemState.status = 'completed';
  } else {
    itemState.lastResult = 'incorrect';
  }

  progress.lastPlayedAt = now;
  syncProgressDocument(progress, items, subtopic);

  if (!preview) {
    await progress.save();
    await recordAttempt(user, topic, subtopic, item, evaluation, starsAwarded);
  }

  return {
    accepted: true,
    isCorrect: evaluation.correct,
    completed: evaluation.completed,
    feedbackMessage: evaluation.feedbackMessage,
    starsAwarded,
    progress: buildProgressSummary(progress, items, subtopic),
  };
}

async function resetSubtopicProgress({ user, subtopicStableId, preview = false }) {
  const visibilityFilter = buildVisibilityFilter(preview);
  const subtopic = await LearningSubtopic.findOne({ stableId: subtopicStableId, ...visibilityFilter });
  if (!subtopic) {
    throw createError('Learning subtopic not found.', 404);
  }

  const topic = await LearningTopic.findById(subtopic.topicId);
  if (!topic) {
    throw createError('Learning topic not found.', 404);
  }

  const items = sortByOrderThenTitle(await LearningItem.find({
    subtopicId: subtopic._id,
    ...visibilityFilter,
  }));

  if (preview) {
    const progress = buildProgressDocument(user, topic, subtopic, items);
    return {
      progress: buildProgressSummary(progress, items, subtopic),
    };
  }

  await LearningProgress.deleteOne({
    userId: user._id,
    subtopicId: subtopic._id,
  });

  const progress = await ensureProgressDocument(user, topic, subtopic, items);

  return {
    progress: buildProgressSummary(progress, items, subtopic),
  };
}

function getTopicForm(topic = null) {
  const theme = topic?.theme || {};
  const reward = topic?.reward || {};
  return {
    _id: topic ? String(topic._id) : '',
    stableId: topic?.stableId || '',
    title: topic?.title || '',
    shortLabel: topic?.shortLabel || '',
    slug: topic?.slug || '',
    description: topic?.description || '',
    status: topic?.status || CONTENT_STATUS.DRAFT,
    order: topic?.order ?? 0,
    topicAccentColor: theme.accentColor || '',
    topicAccentColorSoft: theme.accentColorSoft || '',
    topicBackgroundStart: theme.backgroundStart || '',
    topicBackgroundEnd: theme.backgroundEnd || '',
    topicGlowColor: theme.glowColor || '',
    topicBackgroundImageUrl: theme.backgroundImageUrl || '',
    topicPattern: theme.pattern || '',
    topicIconArtKind: theme.iconArt?.kind || ART_KINDS.BUILTIN,
    topicIconArtValue: theme.iconArt?.value || 'chemistry',
    topicMascotArtKind: theme.mascotArt?.kind || ART_KINDS.BUILTIN,
    topicMascotArtValue: theme.mascotArt?.value || 'mascot',
    topicBadgeArtKind: theme.badgeArt?.kind || ART_KINDS.EMOJI,
    topicBadgeArtValue: theme.badgeArt?.value || '⭐',
    topicRewardLabel: reward.label || '',
    topicRewardDescription: reward.description || '',
    topicRewardArtKind: reward.stickerArt?.kind || ART_KINDS.EMOJI,
    topicRewardArtValue: reward.stickerArt?.value || '🏅',
  };
}

function getSubtopicForm(subtopic = null, fallbackTopicId = '') {
  const theme = subtopic?.theme || {};
  const reward = subtopic?.reward || {};
  return {
    _id: subtopic ? String(subtopic._id) : '',
    stableId: subtopic?.stableId || '',
    topicId: subtopic ? String(subtopic.topicId) : fallbackTopicId || '',
    title: subtopic?.title || '',
    slug: subtopic?.slug || '',
    description: subtopic?.description || '',
    status: subtopic?.status || CONTENT_STATUS.DRAFT,
    order: subtopic?.order ?? 0,
    estimatedMinutes: subtopic?.estimatedMinutes ?? 3,
    subtopicAccentColor: theme.accentColor || '',
    subtopicAccentColorSoft: theme.accentColorSoft || '',
    subtopicBackgroundStart: theme.backgroundStart || '',
    subtopicBackgroundEnd: theme.backgroundEnd || '',
    subtopicGlowColor: theme.glowColor || '',
    subtopicBackgroundImageUrl: theme.backgroundImageUrl || '',
    subtopicPattern: theme.pattern || '',
    subtopicIconArtKind: theme.iconArt?.kind || ART_KINDS.BUILTIN,
    subtopicIconArtValue: theme.iconArt?.value || 'chemistry',
    subtopicMascotArtKind: theme.mascotArt?.kind || ART_KINDS.BUILTIN,
    subtopicMascotArtValue: theme.mascotArt?.value || 'mascot',
    subtopicBadgeArtKind: theme.badgeArt?.kind || ART_KINDS.EMOJI,
    subtopicBadgeArtValue: theme.badgeArt?.value || '⭐',
    subtopicRewardLabel: reward.label || '',
    subtopicRewardDescription: reward.description || '',
    subtopicRewardArtKind: reward.stickerArt?.kind || ART_KINDS.EMOJI,
    subtopicRewardArtValue: reward.stickerArt?.value || '🏅',
  };
}

function getItemForm(item = null, fallbackSubtopicId = '') {
  const config = item?.config || {};
  const choiceOptions = Array.from({ length: 4 }).map((_, index) => {
    const option = Array.isArray(config.options) ? config.options[index] || {} : {};
    return {
      key: option.key || '',
      label: option.label || '',
      artKind: option.art?.kind || ART_KINDS.BUILTIN,
      artValue: option.art?.value || '',
    };
  });

  return {
    _id: item ? String(item._id) : '',
    stableId: item?.stableId || '',
    subtopicId: item ? String(item.subtopicId) : fallbackSubtopicId || '',
    title: item?.title || '',
    prompt: item?.prompt || '',
    helperText: item?.helperText || '',
    blurb: item?.blurb || '',
    status: item?.status || CONTENT_STATUS.DRAFT,
    order: item?.order ?? 0,
    points: item?.points ?? 1,
    templateType: item?.templateType || TEMPLATE_TYPES.SINGLE_CHOICE,
    sceneType: config.sceneType || SCENE_TYPES.ATOM_PLAY,
    sceneBodyText: config.bodyText || '',
    sceneHintText: config.hintText || '',
    sceneExampleText: config.exampleText || '',
    scenePieces: Array.isArray(config.pieces) ? config.pieces.join(', ') : '',
    sceneSlotCount: config.slotCount ?? 3,
    correctOptionKey: config.correctOptionKey || '',
    choiceOptions,
    targetCount: config.target ?? 2,
    maxCount: config.max ?? 8,
    counterLabel: config.counterLabel || 'Electrons',
    builderPieces: Array.isArray(config.pieces) ? config.pieces.join(', ') : '',
    builderTargetSequence: Array.isArray(config.targetSequence) ? config.targetSequence.join(', ') : '',
    builderSlotCount: config.slots ?? 3,
    startState: config.startState || 'solid',
    targetState: config.targetState || 'gas',
    showCoolButton: config.showCoolButton !== false,
    goodFeedback: config.goodFeedback || config.completeMessage || '',
    badFeedback: config.badFeedback || '',
  };
}

async function getAdminDashboardData({
  selectedTopicId = '',
  selectedSubtopicId = '',
  selectedItemId = '',
  creatingTopic = false,
  creatingSubtopic = false,
  creatingItem = false,
} = {}) {
  const topics = sortByOrderThenTitle(await LearningTopic.find().lean());
  const subtopics = sortByOrderThenTitle(await LearningSubtopic.find().lean());
  const items = sortByOrderThenTitle(await LearningItem.find().lean());
  const artAssets = await loadLearningArtAssets();
  const artLibrary = {
    uploaded: buildUploadedBuiltinArtChoices(artAssets),
    system: getSystemBuiltinArtChoices(),
  };
  artLibrary.combined = [...artLibrary.uploaded, ...artLibrary.system];

  const itemsBySubtopic = new Map();
  items.forEach((item) => {
    const key = String(item.subtopicId);
    if (!itemsBySubtopic.has(key)) {
      itemsBySubtopic.set(key, []);
    }
    itemsBySubtopic.get(key).push(item);
  });

  const subtopicsByTopic = new Map();
  subtopics.forEach((subtopic) => {
    const key = String(subtopic.topicId);
    if (!subtopicsByTopic.has(key)) {
      subtopicsByTopic.set(key, []);
    }
    subtopicsByTopic.get(key).push({
      ...subtopic,
      _id: String(subtopic._id),
      topicId: String(subtopic.topicId),
      previewPath: withPreview(`/learning/topic/${subtopic.topicSlug}/${subtopic.slug}`, true),
      itemCount: (itemsBySubtopic.get(String(subtopic._id)) || []).length,
      items: (itemsBySubtopic.get(String(subtopic._id)) || []).map((item) => ({
        ...item,
        _id: String(item._id),
        subtopicId: String(item.subtopicId),
      })),
    });
  });

  const topicsTree = topics.map((topic) => ({
    ...topic,
    _id: String(topic._id),
    previewPath: withPreview(`/learning/topic/${topic.slug}`, true),
    subtopics: sortByOrderThenTitle(subtopicsByTopic.get(String(topic._id)) || []),
  }));

  let topicContext = topics.find((topic) => String(topic._id) === selectedTopicId) || null;
  let subtopicContext = subtopics.find((subtopic) => String(subtopic._id) === selectedSubtopicId) || null;
  let itemContext = items.find((item) => String(item._id) === selectedItemId) || null;

  if (!subtopicContext && itemContext) {
    subtopicContext = subtopics.find((subtopic) => String(subtopic._id) === String(itemContext.subtopicId)) || null;
  }
  if (!topicContext && subtopicContext) {
    topicContext = topics.find((topic) => String(topic._id) === String(subtopicContext.topicId)) || null;
  }
  if (!topicContext && topics.length) {
    topicContext = topics[0];
  }
  if (!subtopicContext && topicContext) {
    subtopicContext = subtopics.find((subtopic) => String(subtopic.topicId) === String(topicContext._id)) || null;
  }
  if (!itemContext && subtopicContext) {
    itemContext = items.find((item) => String(item.subtopicId) === String(subtopicContext._id)) || null;
  }

  return {
    topicsTree,
    topicOptions: topics.map((topic) => ({
      value: String(topic._id),
      label: `${topic.title} (${topic.status})`,
    })),
    subtopicOptions: subtopics.map((subtopic) => ({
      value: String(subtopic._id),
      label: `${subtopic.title} (${subtopic.status})`,
    })),
    selectedTopic: creatingTopic ? getTopicForm(null) : getTopicForm(topicContext),
    selectedSubtopic: creatingSubtopic
      ? getSubtopicForm(null, topicContext ? String(topicContext._id) : '')
      : getSubtopicForm(subtopicContext, topicContext ? String(topicContext._id) : ''),
    selectedItem: creatingItem
      ? getItemForm(null, subtopicContext ? String(subtopicContext._id) : '')
      : getItemForm(itemContext, subtopicContext ? String(subtopicContext._id) : ''),
    selectedTopicContextId: topicContext ? String(topicContext._id) : '',
    selectedSubtopicContextId: subtopicContext ? String(subtopicContext._id) : '',
    selectedItemContextId: itemContext ? String(itemContext._id) : '',
    selectionState: {
      creatingTopic,
      creatingSubtopic,
      creatingItem,
    },
    selectedSubtopicPreviewPath: subtopicContext ? withPreview(`/learning/topic/${subtopicContext.topicSlug}/${subtopicContext.slug}`, true) : null,
    templateOptions: TEMPLATE_OPTIONS,
    sceneOptions: SCENE_OPTIONS,
    stateOptions: STATE_OPTIONS,
    artKindOptions: ART_KIND_OPTIONS,
    patternOptions: PATTERN_OPTIONS,
    artLibrary,
  };
}

async function getAdminArtLibraryData() {
  const artAssets = await loadLearningArtAssets();
  const uploaded = buildUploadedBuiltinArtChoices(artAssets);
  const system = getSystemBuiltinArtChoices();

  return {
    artLibrary: {
      uploaded,
      system,
      combined: [...uploaded, ...system],
    },
    stats: {
      uploadedCount: uploaded.length,
      systemCount: system.length,
      totalCount: uploaded.length + system.length,
    },
  };
}

function hasStartedProgress(progressDoc) {
  if (!progressDoc) {
    return false;
  }

  return progressDoc.status === 'in_progress'
    || progressDoc.status === 'completed'
    || Boolean(progressDoc.startedAt)
    || Boolean(progressDoc.lastPlayedAt)
    || Boolean(progressDoc.completedAt)
    || (Number(progressDoc.totalStars) || 0) > 0;
}

function hasCompletedProgress(progressDoc) {
  return Boolean(progressDoc) && (progressDoc.status === 'completed' || Boolean(progressDoc.completedAt));
}

function buildLearningContentIndex(topics, subtopics, items) {
  const plainTopics = topics.map((topic) => toPlainObject(topic));
  const plainSubtopics = subtopics.map((subtopic) => toPlainObject(subtopic));
  const plainItems = items.map((item) => toPlainObject(item));

  const topicMap = new Map(plainTopics.map((topic) => [String(topic._id), topic]));
  const subtopicMap = new Map(plainSubtopics.map((subtopic) => [String(subtopic._id), subtopic]));
  const itemMap = new Map(plainItems.map((item) => [String(item._id), item]));
  const subtopicStarTotals = new Map();

  plainItems.forEach((item) => {
    const key = String(item.subtopicId);
    subtopicStarTotals.set(key, (subtopicStarTotals.get(key) || 0) + computeItemStarValue(item));
  });

  const topicStarTotals = new Map();
  plainSubtopics.forEach((subtopic) => {
    const topicKey = String(subtopic.topicId);
    const stars = subtopicStarTotals.get(String(subtopic._id)) || 0;
    topicStarTotals.set(topicKey, (topicStarTotals.get(topicKey) || 0) + stars);
  });

  return {
    topics: plainTopics,
    subtopics: plainSubtopics,
    items: plainItems,
    topicMap,
    subtopicMap,
    itemMap,
    subtopicStarTotals,
    topicStarTotals,
    totalLibrarySubtopics: plainSubtopics.length,
    totalLibraryStars: Array.from(subtopicStarTotals.values()).reduce((sum, value) => sum + value, 0),
  };
}

function buildUserLearningSummary(userDoc, progressDocs, attempts, contentIndex) {
  const user = toPlainObject(userDoc) || {};
  const userProgressDocs = progressDocs.map((progress) => toPlainObject(progress));
  const userAttempts = attempts.map((attempt) => toPlainObject(attempt));
  const starsEarned = userProgressDocs.reduce((sum, progress) => sum + (Number(progress.totalStars) || 0), 0);
  const startedSubtopics = userProgressDocs.filter((progress) => hasStartedProgress(progress)).length;
  const completedSubtopics = userProgressDocs.filter((progress) => hasCompletedProgress(progress)).length;
  const stickerCount = userProgressDocs.filter((progress) => progress.stickerUnlocked).length;
  const attemptCount = userAttempts.length;
  const correctAttempts = userAttempts.filter((attempt) => attempt.isCorrect === true).length;
  const accuracyPercent = attemptCount > 0 ? Math.round((correctAttempts / attemptCount) * 100) : 0;
  const firstActivityAt = pickEarliestDate(
    userProgressDocs.map((progress) => progress.startedAt),
    userProgressDocs.map((progress) => progress.completedAt),
    userProgressDocs.map((progress) => progress.lastPlayedAt),
    userAttempts.map((attempt) => attempt.createdAt)
  );
  const lastActivityAt = pickLatestDate(
    userProgressDocs.map((progress) => progress.lastPlayedAt),
    userProgressDocs.map((progress) => progress.completedAt),
    userProgressDocs.map((progress) => progress.updatedAt),
    userAttempts.map((attempt) => attempt.createdAt)
  );
  const favoriteTemplateCounts = new Map();
  const favoriteTopicCounts = new Map();

  userAttempts.forEach((attempt) => {
    if (attempt.templateType) {
      favoriteTemplateCounts.set(attempt.templateType, (favoriteTemplateCounts.get(attempt.templateType) || 0) + 1);
    }
    if (attempt.topicId) {
      const topicKey = String(attempt.topicId);
      favoriteTopicCounts.set(topicKey, (favoriteTopicCounts.get(topicKey) || 0) + 1);
    }
  });

  if (!favoriteTopicCounts.size) {
    userProgressDocs.forEach((progress) => {
      if (progress.topicId && hasStartedProgress(progress)) {
        const topicKey = String(progress.topicId);
        favoriteTopicCounts.set(topicKey, (favoriteTopicCounts.get(topicKey) || 0) + 1);
      }
    });
  }

  const favoriteTemplateEntry = [...favoriteTemplateCounts.entries()].sort((left, right) => right[1] - left[1])[0] || null;
  const favoriteTopicEntry = [...favoriteTopicCounts.entries()].sort((left, right) => right[1] - left[1])[0] || null;
  const currentLessonProgress = [...userProgressDocs]
    .filter((progress) => hasStartedProgress(progress) && !hasCompletedProgress(progress))
    .sort((left, right) => compareDateDesc(left.lastPlayedAt || left.updatedAt || left.startedAt, right.lastPlayedAt || right.updatedAt || right.startedAt))[0] || null;
  const currentLesson = currentLessonProgress
    ? (contentIndex.subtopicMap.get(String(currentLessonProgress.subtopicId))?.title
      || currentLessonProgress.subtopicSlug
      || currentLessonProgress.subtopicStableId
      || 'Current lesson')
    : '—';

  return {
    _id: String(user._id || ''),
    name: user.name || 'Unknown user',
    email: user.email || '',
    typeUser: user.type_user || '',
    starsEarned,
    availableStars: contentIndex.totalLibraryStars,
    starPercent: contentIndex.totalLibraryStars > 0 ? Math.round((starsEarned / contentIndex.totalLibraryStars) * 100) : 0,
    startedSubtopics,
    completedSubtopics,
    totalSubtopics: contentIndex.totalLibrarySubtopics,
    completionPercent: contentIndex.totalLibrarySubtopics > 0
      ? Math.round((completedSubtopics / contentIndex.totalLibrarySubtopics) * 100)
      : 0,
    stickerCount,
    attemptCount,
    correctAttempts,
    accuracyPercent,
    firstActivityAt,
    firstActivityAtDisplay: firstActivityAt ? formatAdminDateTime(firstActivityAt) : 'No activity yet',
    lastActivityAt,
    lastActivityAtDisplay: lastActivityAt ? formatAdminDateTime(lastActivityAt) : 'No activity yet',
    favoriteTemplate: favoriteTemplateEntry ? describeTemplateType(favoriteTemplateEntry[0]) : '—',
    favoriteTopic: favoriteTopicEntry ? (contentIndex.topicMap.get(favoriteTopicEntry[0])?.title || 'Unknown topic') : '—',
    currentLesson,
    isActive: Boolean(lastActivityAt),
    profilePath: `/admin/learning/users/${user._id}`,
  };
}

function buildUserLearningTimeline(progressDocs, attempts, contentIndex) {
  const events = [];

  progressDocs.map((progress) => toPlainObject(progress)).forEach((progress) => {
    const topic = contentIndex.topicMap.get(String(progress.topicId));
    const subtopic = contentIndex.subtopicMap.get(String(progress.subtopicId));
    const subtopicTitle = subtopic?.title || progress.subtopicSlug || progress.subtopicStableId || 'Lesson';
    const topicTitle = topic?.title || progress.topicSlug || progress.topicStableId || 'Topic';

    if (progress.startedAt) {
      events.push({
        key: `started_${progress._id || progress.subtopicStableId}`,
        tone: 'info',
        at: progress.startedAt,
        atDisplay: formatAdminDateTime(progress.startedAt),
        title: `Started ${subtopicTitle}`,
        subtitle: topicTitle,
        detail: progress.currentItemStableId ? `Current checkpoint: ${progress.currentItemStableId}` : 'Lesson opened for the first time.',
      });
    }

    if (progress.completedAt) {
      const rewardLabel = progress.stickerLabel ? ` • ${progress.stickerLabel}` : '';
      events.push({
        key: `completed_${progress._id || progress.subtopicStableId}`,
        tone: 'success',
        at: progress.completedAt,
        atDisplay: formatAdminDateTime(progress.completedAt),
        title: `Completed ${subtopicTitle}`,
        subtitle: topicTitle,
        detail: `${Number(progress.totalStars) || 0}/${Number(progress.maxStars) || 0} stars${rewardLabel}`,
      });
    }
  });

  attempts.map((attempt) => toPlainObject(attempt)).forEach((attempt) => {
    const topic = contentIndex.topicMap.get(String(attempt.topicId));
    const subtopic = contentIndex.subtopicMap.get(String(attempt.subtopicId));
    const item = contentIndex.itemMap.get(String(attempt.itemId));
    const topicTitle = topic?.title || attempt.topicStableId || 'Topic';
    const subtopicTitle = subtopic?.title || attempt.subtopicStableId || 'Lesson';
    const itemTitle = item?.title || attempt.itemStableId || 'Learning item';
    const isPositive = attempt.isCorrect === true || attempt.completed === true;
    const detailParts = [subtopicTitle];

    if ((Number(attempt.starsAwarded) || 0) > 0) {
      detailParts.push(`+${attempt.starsAwarded} ⭐`);
    }
    if (attempt.feedbackMessage) {
      detailParts.push(normalizeText(attempt.feedbackMessage, 120));
    }

    events.push({
      key: `attempt_${attempt._id || `${attempt.itemStableId}_${attempt.createdAt}`}`,
      tone: isPositive ? 'success' : 'warning',
      at: attempt.createdAt,
      atDisplay: formatAdminDateTime(attempt.createdAt),
      title: isPositive ? `Progress on ${itemTitle}` : `Tried ${itemTitle}`,
      subtitle: topicTitle,
      detail: detailParts.join(' • '),
    });
  });

  return events
    .filter((event) => event.at)
    .sort((left, right) => compareDateDesc(left.at, right.at));
}

async function getAdminUsersProgressData() {
  const [users, topics, subtopics, items, progressDocs, attempts] = await Promise.all([
    UserAccount.find({}),
    LearningTopic.find({}),
    LearningSubtopic.find({}),
    LearningItem.find({}),
    LearningProgress.find({}),
    LearningAttempt.find({}),
  ]);

  const contentIndex = buildLearningContentIndex(topics, subtopics, items);
  const progressByUser = new Map();
  const attemptsByUser = new Map();

  progressDocs.forEach((progress) => {
    const key = String(progress.userId);
    if (!progressByUser.has(key)) {
      progressByUser.set(key, []);
    }
    progressByUser.get(key).push(progress);
  });

  attempts.forEach((attempt) => {
    const key = String(attempt.userId);
    if (!attemptsByUser.has(key)) {
      attemptsByUser.set(key, []);
    }
    attemptsByUser.get(key).push(attempt);
  });

  const userSummaries = users
    .map((user) => buildUserLearningSummary(
      user,
      progressByUser.get(String(user._id)) || [],
      attemptsByUser.get(String(user._id)) || [],
      contentIndex
    ))
    .sort((left, right) => {
      if (right.completedSubtopics !== left.completedSubtopics) {
        return right.completedSubtopics - left.completedSubtopics;
      }
      if (right.starsEarned !== left.starsEarned) {
        return right.starsEarned - left.starsEarned;
      }
      const lastActivityDelta = compareDateDesc(left.lastActivityAt, right.lastActivityAt);
      if (lastActivityDelta !== 0) {
        return lastActivityDelta;
      }
      return String(left.name || '').localeCompare(String(right.name || ''));
    });

  const totals = userSummaries.reduce((summary, user) => {
    summary.userCount += 1;
    summary.activeLearnerCount += user.isActive ? 1 : 0;
    summary.completedSubtopics += user.completedSubtopics;
    summary.starsEarned += user.starsEarned;
    summary.attemptCount += user.attemptCount;
    return summary;
  }, {
    userCount: 0,
    activeLearnerCount: 0,
    completedSubtopics: 0,
    starsEarned: 0,
    attemptCount: 0,
  });

  totals.topicCount = contentIndex.topics.length;
  totals.subtopicCount = contentIndex.totalLibrarySubtopics;
  totals.availableStars = contentIndex.totalLibraryStars;

  return {
    users: userSummaries,
    totals,
    hasLearningData: progressDocs.length > 0 || attempts.length > 0,
  };
}

async function getAdminUserLearningProfileData(userId) {
  const user = await UserAccount.findById(userId);
  if (!user) {
    throw createError('Learning user not found.', 404);
  }

  const [topics, subtopics, items, progressDocs, attempts] = await Promise.all([
    LearningTopic.find({}),
    LearningSubtopic.find({}),
    LearningItem.find({}),
    LearningProgress.find({ userId }),
    LearningAttempt.find({ userId }),
  ]);

  const contentIndex = buildLearningContentIndex(topics, subtopics, items);
  const summary = buildUserLearningSummary(user, progressDocs, attempts, contentIndex);
  const plainProgressDocs = progressDocs.map((progress) => toPlainObject(progress));
  const plainAttempts = attempts.map((attempt) => toPlainObject(attempt));

  const topicProgress = sortByOrderThenTitle(contentIndex.topics.map((topic) => {
    const topicProgressDocs = plainProgressDocs.filter((progress) => String(progress.topicId) === String(topic._id));
    const topicAttempts = plainAttempts.filter((attempt) => String(attempt.topicId) === String(topic._id));
    const availableSubtopics = contentIndex.subtopics.filter((subtopic) => String(subtopic.topicId) === String(topic._id));
    const starsEarned = topicProgressDocs.reduce((sum, progress) => sum + (Number(progress.totalStars) || 0), 0);
    const startedSubtopics = topicProgressDocs.filter((progress) => hasStartedProgress(progress)).length;
    const completedSubtopics = topicProgressDocs.filter((progress) => hasCompletedProgress(progress)).length;
    const lastActivityAt = pickLatestDate(
      topicProgressDocs.map((progress) => progress.lastPlayedAt),
      topicProgressDocs.map((progress) => progress.completedAt),
      topicAttempts.map((attempt) => attempt.createdAt)
    );

    return {
      _id: String(topic._id),
      title: topic.title,
      slug: topic.slug,
      status: topic.status,
      startedSubtopics,
      completedSubtopics,
      totalSubtopics: availableSubtopics.length,
      completionPercent: availableSubtopics.length > 0 ? Math.round((completedSubtopics / availableSubtopics.length) * 100) : 0,
      starsEarned,
      availableStars: contentIndex.topicStarTotals.get(String(topic._id)) || 0,
      starPercent: (contentIndex.topicStarTotals.get(String(topic._id)) || 0) > 0
        ? Math.round((starsEarned / (contentIndex.topicStarTotals.get(String(topic._id)) || 0)) * 100)
        : 0,
      lastActivityAt,
      lastActivityAtDisplay: lastActivityAt ? formatAdminDateTime(lastActivityAt) : 'No activity yet',
      isStarted: startedSubtopics > 0 || topicAttempts.length > 0,
    };
  }));

  const recentRewards = plainProgressDocs
    .filter((progress) => progress.stickerUnlocked)
    .map((progress) => {
      const topic = contentIndex.topicMap.get(String(progress.topicId));
      const subtopic = contentIndex.subtopicMap.get(String(progress.subtopicId));
      const unlockedAt = progress.completedAt || progress.updatedAt;

      return {
        key: `reward_${progress._id || progress.subtopicStableId}`,
        title: progress.stickerLabel || subtopic?.reward?.label || `${subtopic?.title || 'Lesson'} sticker`,
        topicTitle: topic?.title || progress.topicSlug || 'Topic',
        subtopicTitle: subtopic?.title || progress.subtopicSlug || 'Lesson',
        unlockedAt,
        unlockedAtDisplay: unlockedAt ? formatAdminDateTime(unlockedAt) : 'No activity yet',
      };
    })
    .sort((left, right) => compareDateDesc(left.unlockedAt, right.unlockedAt));

  return {
    user: {
      _id: String(user._id),
      name: user.name,
      email: user.email,
      typeUser: user.type_user,
      joinedDisplay: formatAdminDate(user._id?.getTimestamp ? user._id.getTimestamp() : null),
    },
    summary,
    topicProgress,
    recentRewards,
    timeline: buildUserLearningTimeline(plainProgressDocs, plainAttempts, contentIndex).slice(0, 80),
    contentTotals: {
      topicCount: contentIndex.topics.length,
      subtopicCount: contentIndex.totalLibrarySubtopics,
      availableStars: contentIndex.totalLibraryStars,
    },
  };
}

async function saveArtAssetFromUpload({ body = {}, file = null, userName = '' } = {}) {
  const rawSvg = file?.buffer ? file.buffer.toString('utf8') : String(body.svgMarkup || '');
  const cleanSvg = sanitizeSvgMarkup(rawSvg);
  const requestedTitle = normalizeText(body.title, 120, { multiline: false });
  const requestedKey = normalizeText(body.key, 120, { multiline: false });
  const fileBaseName = normalizeText(String(file?.originalname || '').replace(/\.svg$/i, ''), 120, { multiline: false });
  const baseKey = requestedKey || requestedTitle || fileBaseName || 'art';
  const normalizedKey = slugify(baseKey, 'art');

  if (SYSTEM_BUILTIN_ART_KEY_SET.has(normalizedKey)) {
    throw createError('That art value is reserved by the system library. Choose a different key.');
  }

  const uniqueKey = await ensureUniqueFieldValue(LearningArtAsset, 'key', normalizedKey, 'art');
  const fallbackTitle = uniqueKey
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  const asset = new LearningArtAsset({
    stableId: generateStableId('art'),
    createdBy: userName,
  });

  asset.key = uniqueKey;
  asset.title = requestedTitle || fileBaseName || fallbackTitle;
  asset.description = normalizeText(body.description, 280);
  asset.svgMarkup = cleanSvg;
  asset.updatedBy = userName;

  await asset.save();
  return asset;
}

async function syncTopicReferences(topic) {
  await Promise.all([
    LearningSubtopic.updateMany(
      { topicId: topic._id },
      {
        $set: {
          topicStableId: topic.stableId,
          topicSlug: topic.slug,
        },
      }
    ),
    LearningItem.updateMany(
      { topicId: topic._id },
      {
        $set: {
          topicStableId: topic.stableId,
          topicSlug: topic.slug,
        },
      }
    ),
    LearningProgress.updateMany(
      { topicId: topic._id },
      {
        $set: {
          topicStableId: topic.stableId,
          topicSlug: topic.slug,
        },
      }
    ),
    LearningAttempt.updateMany(
      { topicId: topic._id },
      {
        $set: {
          topicStableId: topic.stableId,
        },
      }
    ),
  ]);
}

async function syncSubtopicReferences(subtopic, topic) {
  const resolvedTopic = topic || await LearningTopic.findById(subtopic.topicId);
  if (!resolvedTopic) {
    throw createError('Selected topic does not exist.', 404);
  }

  await Promise.all([
    LearningItem.updateMany(
      { subtopicId: subtopic._id },
      {
        $set: {
          topicId: resolvedTopic._id,
          topicStableId: resolvedTopic.stableId,
          topicSlug: resolvedTopic.slug,
          subtopicStableId: subtopic.stableId,
          subtopicSlug: subtopic.slug,
        },
      }
    ),
    LearningProgress.updateMany(
      { subtopicId: subtopic._id },
      {
        $set: {
          topicId: resolvedTopic._id,
          topicStableId: resolvedTopic.stableId,
          topicSlug: resolvedTopic.slug,
          subtopicStableId: subtopic.stableId,
          subtopicSlug: subtopic.slug,
        },
      }
    ),
    LearningAttempt.updateMany(
      { subtopicId: subtopic._id },
      {
        $set: {
          topicId: resolvedTopic._id,
          topicStableId: resolvedTopic.stableId,
          subtopicStableId: subtopic.stableId,
        },
      }
    ),
  ]);
}

async function saveTopicFromForm(body, userName) {
  const topicId = normalizeText(body.topicId, 64, { multiline: false });
  const existing = topicId ? await LearningTopic.findById(topicId) : null;
  const title = normalizeText(body.title, 120, { multiline: false });
  if (!title) {
    throw createError('Topic title is required.');
  }

  const baseSlug = body.slug || title;
  const slug = await ensureUniqueSlug(LearningTopic, baseSlug, {}, existing?._id || null);
  const topic = existing || new LearningTopic({
    stableId: generateStableId('topic'),
    createdBy: userName,
  });
  const previousSlug = existing?.slug || '';

  topic.slug = slug;
  topic.title = title;
  topic.shortLabel = normalizeText(body.shortLabel, 60, { multiline: false });
  topic.description = normalizeText(body.description, 500);
  topic.status = normalizeStatus(body.status);
  topic.order = normalizeInteger(body.order, 0, 0, 9999);
  topic.theme = buildThemePatchFromForm(body, 'topic');
  topic.reward = buildRewardPatchFromForm(body, 'topic', `${title} badge`);
  topic.updatedBy = userName;

  await topic.save();

  if (existing && previousSlug !== topic.slug) {
    await syncTopicReferences(topic);
  }

  return topic;
}

async function saveSubtopicFromForm(body, userName) {
  const subtopicId = normalizeText(body.subtopicId, 64, { multiline: false });
  const existing = subtopicId ? await LearningSubtopic.findById(subtopicId) : null;
  const topicId = normalizeText(body.topicId, 64, { multiline: false });
  if (!topicId) {
    throw createError('Choose a topic for the subtopic.');
  }

  const topic = await LearningTopic.findById(topicId);
  if (!topic) {
    throw createError('Selected topic does not exist.', 404);
  }

  const title = normalizeText(body.title, 120, { multiline: false });
  if (!title) {
    throw createError('Subtopic title is required.');
  }

  const slug = await ensureUniqueSlug(
    LearningSubtopic,
    body.slug || title,
    { topicId: topic._id },
    existing?._id || null
  );

  const subtopic = existing || new LearningSubtopic({
    stableId: generateStableId('subtopic'),
    createdBy: userName,
  });
  const previousTopicId = existing ? String(existing.topicId) : '';
  const previousSlug = existing?.slug || '';

  subtopic.topicId = topic._id;
  subtopic.topicStableId = topic.stableId;
  subtopic.topicSlug = topic.slug;
  subtopic.slug = slug;
  subtopic.title = title;
  subtopic.description = normalizeText(body.description, 500);
  subtopic.status = normalizeStatus(body.status);
  subtopic.order = normalizeInteger(body.order, 0, 0, 9999);
  subtopic.estimatedMinutes = normalizeInteger(body.estimatedMinutes, 3, 1, 120);
  subtopic.theme = buildThemePatchFromForm(body, 'subtopic');
  subtopic.reward = buildRewardPatchFromForm(body, 'subtopic', `${title} sticker`);
  subtopic.updatedBy = userName;

  await subtopic.save();

  if (existing && (previousTopicId !== String(subtopic.topicId) || previousSlug !== subtopic.slug || existing.topicSlug !== subtopic.topicSlug)) {
    await syncSubtopicReferences(subtopic, topic);
  }

  return subtopic;
}

async function saveItemFromForm(body, userName) {
  const itemId = normalizeText(body.itemId, 64, { multiline: false });
  const existing = itemId ? await LearningItem.findById(itemId) : null;
  const subtopicId = normalizeText(body.subtopicId, 64, { multiline: false });
  if (!subtopicId) {
    throw createError('Choose a subtopic for the item.');
  }

  const subtopic = await LearningSubtopic.findById(subtopicId);
  if (!subtopic) {
    throw createError('Selected subtopic does not exist.', 404);
  }

  const topic = await LearningTopic.findById(subtopic.topicId);
  if (!topic) {
    throw createError('Selected topic does not exist.', 404);
  }

  const title = normalizeText(body.title, 120, { multiline: false });
  if (!title) {
    throw createError('Item title is required.');
  }

  const templateType = normalizeTemplateType(body.templateType);
  const item = existing || new LearningItem({
    stableId: generateStableId('item'),
    createdBy: userName,
  });

  item.topicId = topic._id;
  item.topicStableId = topic.stableId;
  item.topicSlug = topic.slug;
  item.subtopicId = subtopic._id;
  item.subtopicStableId = subtopic.stableId;
  item.subtopicSlug = subtopic.slug;
  item.title = title;
  item.prompt = normalizeText(body.prompt, 280);
  item.helperText = normalizeText(body.helperText, 280);
  item.blurb = normalizeText(body.blurb, 280);
  item.templateType = templateType;
  item.kind = templateType === TEMPLATE_TYPES.SCENE ? 'activity' : 'question';
  item.status = normalizeStatus(body.status);
  item.order = normalizeInteger(body.order, 0, 0, 9999);
  item.points = item.kind === 'question' ? normalizeInteger(body.points, 1, 0, 10) : 0;
  item.config = buildItemConfigFromForm(body, templateType);
  item.updatedBy = userName;

  await item.save();
  return item;
}

async function deleteTopicById(topicId) {
  const topic = await LearningTopic.findById(topicId);
  if (!topic) {
    return false;
  }

  await LearningAttempt.deleteMany({ topicId: topic._id });
  await LearningProgress.deleteMany({ topicId: topic._id });
  await LearningItem.deleteMany({ topicId: topic._id });
  await LearningSubtopic.deleteMany({ topicId: topic._id });
  await LearningTopic.deleteOne({ _id: topic._id });
  return true;
}

async function deleteSubtopicById(subtopicId) {
  const subtopic = await LearningSubtopic.findById(subtopicId);
  if (!subtopic) {
    return false;
  }

  await LearningAttempt.deleteMany({ subtopicId: subtopic._id });
  await LearningProgress.deleteMany({ subtopicId: subtopic._id });
  await LearningItem.deleteMany({ subtopicId: subtopic._id });
  await LearningSubtopic.deleteOne({ _id: subtopic._id });
  return true;
}

async function deleteItemById(itemId) {
  const item = await LearningItem.findById(itemId);
  if (!item) {
    return false;
  }

  await LearningAttempt.deleteMany({ itemId: item._id });
  await LearningProgress.updateMany(
    { subtopicId: item.subtopicId },
    { $pull: { itemStates: { itemId: item._id } } }
  );
  await LearningItem.deleteOne({ _id: item._id });
  return true;
}

async function ensureSeedData() {
  const topicSeed = CHEMISTRY_SEED.topic;
  const existingTopic = await LearningTopic.findOne({ stableId: topicSeed.stableId });
  let topic = existingTopic;

  if (!topic) {
    topic = await LearningTopic.create({
      ...topicSeed,
      reward: {
        label: 'Chemistry Star',
        description: 'A shiny chemistry adventure badge.',
        stickerArt: { kind: ART_KINDS.EMOJI, value: '⭐' },
      },
      createdBy: 'system',
      updatedBy: 'system',
    });
  }

  for (const subtopicSeed of CHEMISTRY_SEED.subtopics) {
    let subtopic = await LearningSubtopic.findOne({ stableId: subtopicSeed.stableId });
    if (!subtopic) {
      subtopic = await LearningSubtopic.create({
        ...subtopicSeed,
        topicId: topic._id,
        topicStableId: topic.stableId,
        topicSlug: topic.slug,
        createdBy: 'system',
        updatedBy: 'system',
      });
    }

    for (const itemSeed of subtopicSeed.items) {
      const existingItem = await LearningItem.findOne({ stableId: itemSeed.stableId });
      if (!existingItem) {
        await LearningItem.create({
          ...itemSeed,
          topicId: topic._id,
          topicStableId: topic.stableId,
          topicSlug: topic.slug,
          subtopicId: subtopic._id,
          subtopicStableId: subtopic.stableId,
          subtopicSlug: subtopic.slug,
          createdBy: 'system',
          updatedBy: 'system',
        });
      }
    }
  }
}

module.exports = {
  ART_KIND_OPTIONS,
  ART_KINDS,
  CONTENT_STATUS,
  DEFAULT_THEME,
  PATTERN_OPTIONS,
  SCENE_OPTIONS,
  SCENE_TYPES,
  STATE_OPTIONS,
  TEMPLATE_OPTIONS,
  TEMPLATE_TYPES,
  buildProgressSummary,
  buildThemeStyleAttribute,
  deleteItemById,
  deleteSubtopicById,
  deleteTopicById,
  ensureSeedData,
  evaluateItemAnswer,
  getAdminArtLibraryData,
  getAdminDashboardData,
  getAdminUserLearningProfileData,
  getAdminUsersProgressData,
  getArtText,
  getHomePageData,
  getSubtopicPlayerData,
  getTopicPageData,
  resolveTheme,
  resetSubtopicProgress,
  saveArtAssetFromUpload,
  saveItemFromForm,
  saveSubtopicFromForm,
  saveTopicFromForm,
  slugify,
  submitItemResponse,
};
