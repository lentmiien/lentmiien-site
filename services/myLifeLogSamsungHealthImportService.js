const path = require('path');
const zlib = require('zlib');
const MyLifeLogImportState = require('../models/my_life_log_import_state');
const {
  parseCsvText,
  parseNumericValue,
  parseTimestampValue,
  formatDateLocal,
} = require('./myLifeLogCsvImportService');

const SAMSUNG_SOURCE = 'samsung_health';
const MAX_EXTRACTED_ENTRY_SIZE = 80 * 1024 * 1024;
const MAX_SAMPLE_LABELS = 8;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

const pad2 = (value) => String(value).padStart(2, '0');

const normalizeHeader = (value) => String(value || '')
  .replace(/^\uFEFF/, '')
  .trim()
  .toLowerCase();

const stripBom = (value) => String(value || '').replace(/^\uFEFF/, '');

const formatDateTimeLocal = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

const formatNumber = (value, fractionDigits = 3) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  if (Number.isInteger(number)) return String(number);
  return String(Number(number.toFixed(fractionDigits)));
};

const normalizeDatasetLabel = (datasetName) => String(datasetName || '')
  .replace(/^com\.samsung\.(?:shealth|health)\./, '')
  .replace(/^tracker\./, '')
  .replace(/[^a-zA-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();

const getLastFullDayEnd = (now = new Date()) => new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate() - 1,
  23,
  59,
  59,
  999
);

const addOneMillisecond = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + 1);
};

const findEndOfCentralDirectory = (buffer) => {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('Unable to read ZIP central directory.');
};

const listZipEntries = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error('Invalid ZIP upload.');
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;
  for (let index = 0; index < entryCount && offset < endOffset; index += 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid ZIP central directory entry.');
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const encoding = flags & 0x0800 ? 'utf8' : 'latin1';
    const name = buffer.toString(encoding, nameStart, nameEnd);

    entries.push({
      name,
      method,
      encrypted: Boolean(flags & 0x0001),
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
};

const extractZipEntry = (buffer, entry) => {
  if (!entry || entry.isDirectory) return Buffer.alloc(0);
  if (entry.encrypted) {
    throw new Error(`Encrypted ZIP entries are not supported: ${entry.name}`);
  }
  if (entry.uncompressedSize > MAX_EXTRACTED_ENTRY_SIZE) {
    throw new Error(`ZIP entry is too large to import: ${entry.name}`);
  }
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid ZIP local file header: ${entry.name}`);
  }

  const fileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  const compressed = buffer.subarray(dataStart, dataEnd);

  if (entry.method === 0) {
    return Buffer.from(compressed);
  }
  if (entry.method === 8) {
    return zlib.inflateRawSync(compressed);
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method}: ${entry.name}`);
};

const findHeader = (headers, wanted) => {
  const normalizedWanted = normalizeHeader(wanted);
  return headers.find((header) => normalizeHeader(header) === normalizedWanted) || '';
};

const getRowValue = (row, headers, source) => {
  const header = findHeader(headers, source);
  if (!header) return '';
  return row[header];
};

const parseTimeOffsetMinutes = (value) => {
  const match = String(value || '').trim().match(/^UTC([+-])(\d{2})(\d{2})$/i);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * ((Number(match[2]) * 60) + Number(match[3]));
};

const parseSamsungTimestamp = (value, offsetValue) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  const offsetMinutes = parseTimeOffsetMinutes(offsetValue);
  if (match && Number.isFinite(offsetMinutes)) {
    const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
    const utcMillis = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(String(millisecond).padEnd(3, '0'))
    ) - (offsetMinutes * 60 * 1000);
    return new Date(utcMillis);
  }

  return parseTimestampValue(raw);
};

const parseSamsungDay = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d{10,}$/.test(raw)) {
    const parsed = new Date(Number(raw));
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0, 0);
    }
  }

  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    const [, year, month, day] = ymd;
    return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
  }

  const parsed = parseTimestampValue(raw);
  if (!parsed) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0);
};

const getTimestampForRow = (row, headers, rule) => {
  const timestampColumn = rule.timestampColumn || 'start_time';
  const raw = getRowValue(row, headers, timestampColumn);
  let parsed = null;
  if (rule.timestampKind === 'day') {
    parsed = parseSamsungDay(raw);
  } else {
    const offset = rule.timeOffsetColumn
      ? getRowValue(row, headers, rule.timeOffsetColumn)
      : getRowValue(row, headers, 'time_offset');
    parsed = parseSamsungTimestamp(raw, offset);
  }

  if (!parsed || parsed.getFullYear() < 2000) {
    return null;
  }
  return parsed;
};

const getDataUuid = (row, headers, rule) => {
  const candidates = [
    rule.idColumn,
    'datauuid',
    `${rule.datasetName}.datauuid`,
    `${rule.prefixedName}.datauuid`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const value = getRowValue(row, headers, candidate);
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
};

const SLEEP_STAGE_NAMES = {
  40001: 'awake',
  40002: 'light',
  40003: 'deep',
  40004: 'rem',
};

const valueTransformers = {
  number: (raw) => parseNumericValue(raw),
  text: (raw) => String(raw || '').trim(),
  durationMsToSeconds: (raw) => {
    const parsed = parseNumericValue(raw);
    if (!parsed) return '';
    return formatNumber(Number(parsed) / 1000, 2);
  },
  durationMsToMinutes: (raw) => {
    const parsed = parseNumericValue(raw);
    if (!parsed) return '';
    return formatNumber(Number(parsed) / 60000, 2);
  },
  sleepStageDurationMinutes: (raw, row, headers) => {
    const start = parseSamsungTimestamp(
      getRowValue(row, headers, 'start_time'),
      getRowValue(row, headers, 'time_offset')
    );
    const end = parseSamsungTimestamp(
      getRowValue(row, headers, 'end_time'),
      getRowValue(row, headers, 'time_offset')
    );
    if (!start || !end || end <= start) return '';
    return formatNumber((end - start) / 60000, 2);
  },
};

const getLabelForColumn = (column, rawValue, row, headers) => {
  if (typeof column.label === 'function') {
    return column.label(rawValue, row, headers);
  }
  return column.label;
};

const sleepStageLabel = (rawValue) => {
  const stage = SLEEP_STAGE_NAMES[String(rawValue || '').trim()] || 'unknown';
  return `sleep_stage_${stage}_minutes`;
};

const buildColumn = (source, label, parser = 'number', extra = {}) => ({
  source,
  label,
  parser,
  ...extra,
});

const samsungDatasetRules = {
  'com.samsung.health.weight': {
    name: 'Weight and body composition',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('weight', 'weight_kg'),
      buildColumn('height', 'height_cm'),
      buildColumn('body_fat', 'body_fat_percent'),
      buildColumn('body_fat_mass', 'body_fat_mass_kg'),
      buildColumn('skeletal_muscle', 'skeletal_muscle_percent'),
      buildColumn('skeletal_muscle_mass', 'skeletal_muscle_mass_kg'),
      buildColumn('muscle_mass', 'muscle_mass_kg'),
      buildColumn('fat_free_mass', 'fat_free_mass_kg'),
      buildColumn('fat_free', 'fat_free_kg'),
      buildColumn('basal_metabolic_rate', 'basal_metabolic_rate_kcal'),
      buildColumn('total_body_water', 'total_body_water_kg'),
      buildColumn('vfa_level', 'visceral_fat_level'),
    ],
  },
  'com.samsung.health.height': {
    name: 'Height',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('height', 'height_cm'),
    ],
  },
  'com.samsung.shealth.tracker.heart_rate': {
    name: 'Heart rate',
    timestampColumn: 'com.samsung.health.heart_rate.start_time',
    timeOffsetColumn: 'com.samsung.health.heart_rate.time_offset',
    idColumn: 'com.samsung.health.heart_rate.datauuid',
    prefixedName: 'com.samsung.health.heart_rate',
    columns: [
      buildColumn('com.samsung.health.heart_rate.heart_rate', 'heart_rate_bpm', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.heart_rate.min', 'heart_rate_min_bpm', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.heart_rate.max', 'heart_rate_max_bpm', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.heart_rate.heart_beat_count', 'heart_rate_beat_count', 'number', { skipZero: true }),
    ],
  },
  'com.samsung.shealth.tracker.oxygen_saturation': {
    name: 'Blood oxygen',
    timestampColumn: 'com.samsung.health.oxygen_saturation.start_time',
    timeOffsetColumn: 'com.samsung.health.oxygen_saturation.time_offset',
    idColumn: 'com.samsung.health.oxygen_saturation.datauuid',
    prefixedName: 'com.samsung.health.oxygen_saturation',
    columns: [
      buildColumn('com.samsung.health.oxygen_saturation.spo2', 'oxygen_saturation_percent', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.oxygen_saturation.min', 'oxygen_saturation_min_percent', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.oxygen_saturation.max', 'oxygen_saturation_max_percent', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.oxygen_saturation.heart_rate', 'oxygen_saturation_heart_rate_bpm', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.oxygen_saturation.low_duration', 'oxygen_saturation_low_duration_seconds', 'durationMsToSeconds'),
    ],
  },
  'com.samsung.shealth.blood_pressure': {
    name: 'Blood pressure',
    timestampColumn: 'com.samsung.health.blood_pressure.start_time',
    timeOffsetColumn: 'com.samsung.health.blood_pressure.time_offset',
    idColumn: 'com.samsung.health.blood_pressure.datauuid',
    prefixedName: 'com.samsung.health.blood_pressure',
    columns: [
      buildColumn('com.samsung.health.blood_pressure.systolic', 'blood_pressure_systolic_mmhg'),
      buildColumn('com.samsung.health.blood_pressure.diastolic', 'blood_pressure_diastolic_mmhg'),
      buildColumn('com.samsung.health.blood_pressure.mean', 'blood_pressure_mean_mmhg'),
      buildColumn('com.samsung.health.blood_pressure.pulse', 'blood_pressure_pulse_bpm'),
    ],
  },
  'com.samsung.shealth.step_daily_trend': {
    name: 'Step daily trend',
    timestampColumn: 'day_time',
    timestampKind: 'day',
    columns: [
      buildColumn('count', 'step_daily_trend_steps'),
      buildColumn('distance', 'step_daily_trend_distance_m'),
      buildColumn('calorie', 'step_daily_trend_calories_kcal'),
      buildColumn('speed', 'step_daily_trend_speed_mps'),
    ],
  },
  'com.samsung.shealth.tracker.pedometer_day_summary': {
    name: 'Pedometer day summary',
    timestampColumn: 'day_time',
    timestampKind: 'day',
    columns: [
      buildColumn('step_count', 'pedometer_daily_steps'),
      buildColumn('walk_step_count', 'pedometer_daily_walk_steps'),
      buildColumn('run_step_count', 'pedometer_daily_run_steps'),
      buildColumn('distance', 'pedometer_daily_distance_m'),
      buildColumn('calorie', 'pedometer_daily_calories_kcal'),
      buildColumn('speed', 'pedometer_daily_speed_mps'),
      buildColumn('active_time', 'pedometer_daily_active_time_minutes', 'durationMsToMinutes'),
    ],
  },
  'com.samsung.shealth.tracker.pedometer_step_count': {
    name: 'Step count samples',
    timestampColumn: 'com.samsung.health.step_count.start_time',
    timeOffsetColumn: 'com.samsung.health.step_count.time_offset',
    idColumn: 'com.samsung.health.step_count.datauuid',
    prefixedName: 'com.samsung.health.step_count',
    columns: [
      buildColumn('com.samsung.health.step_count.count', 'step_count'),
      buildColumn('walk_step', 'step_walk_count'),
      buildColumn('run_step', 'step_run_count'),
      buildColumn('com.samsung.health.step_count.distance', 'step_distance_m'),
      buildColumn('com.samsung.health.step_count.calorie', 'step_calories_kcal'),
      buildColumn('com.samsung.health.step_count.speed', 'step_speed_mps'),
      buildColumn('duration', 'step_duration_seconds', 'durationMsToSeconds'),
    ],
  },
  'com.samsung.shealth.activity.day_summary': {
    name: 'Activity day summary',
    timestampColumn: 'day_time',
    timestampKind: 'day',
    columns: [
      buildColumn('step_count', 'activity_daily_steps'),
      buildColumn('distance', 'activity_daily_distance_m'),
      buildColumn('calorie', 'activity_daily_calories_kcal'),
      buildColumn('floor_count', 'activity_daily_floors'),
      buildColumn('score', 'activity_daily_score'),
      buildColumn('move_hourly_count', 'activity_daily_move_hours'),
      buildColumn('exercise_time', 'activity_daily_exercise_time_minutes', 'durationMsToMinutes'),
      buildColumn('active_time', 'activity_daily_active_time_minutes', 'durationMsToMinutes'),
      buildColumn('dynamic_active_time', 'activity_daily_dynamic_active_time_minutes', 'durationMsToMinutes'),
      buildColumn('walk_time', 'activity_daily_walk_time_minutes', 'durationMsToMinutes'),
      buildColumn('run_time', 'activity_daily_run_time_minutes', 'durationMsToMinutes'),
      buildColumn('longest_active_time', 'activity_daily_longest_active_time_minutes', 'durationMsToMinutes'),
      buildColumn('longest_idle_time', 'activity_daily_longest_idle_time_minutes', 'durationMsToMinutes'),
    ],
  },
  'com.samsung.shealth.activity_level': {
    name: 'Activity level',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('activity_level', 'activity_level'),
    ],
  },
  'com.samsung.health.floors_climbed': {
    name: 'Floors climbed',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('floor', 'floors_climbed'),
    ],
  },
  'com.samsung.shealth.tracker.floors_day_summary': {
    name: 'Floors day summary',
    timestampColumn: 'day_time',
    timestampKind: 'day',
    columns: [
      buildColumn('floor_count', 'floors_daily_count'),
    ],
  },
  'com.samsung.shealth.stress': {
    name: 'Stress',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('score', 'stress_score'),
      buildColumn('min', 'stress_min_score'),
      buildColumn('max', 'stress_max_score'),
    ],
  },
  'com.samsung.health.sleep_stage': {
    name: 'Sleep stages',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('stage', sleepStageLabel, 'sleepStageDurationMinutes'),
    ],
  },
  'com.samsung.shealth.sleep': {
    name: 'Sleep summary',
    timestampColumn: 'com.samsung.health.sleep.start_time',
    timeOffsetColumn: 'com.samsung.health.sleep.time_offset',
    idColumn: 'com.samsung.health.sleep.datauuid',
    prefixedName: 'com.samsung.health.sleep',
    columns: [
      buildColumn('sleep_score', 'sleep_score'),
      buildColumn('sleep_duration', 'sleep_duration_minutes'),
      buildColumn('total_light_duration', 'sleep_light_duration_minutes'),
      buildColumn('total_rem_duration', 'sleep_rem_duration_minutes'),
      buildColumn('sleep_cycle', 'sleep_cycle_count'),
      buildColumn('efficiency', 'sleep_efficiency_percent'),
      buildColumn('mental_recovery', 'sleep_mental_recovery_score'),
      buildColumn('physical_recovery', 'sleep_physical_recovery_score'),
      buildColumn('wake_score', 'sleep_wake_score'),
      buildColumn('deep_score', 'sleep_deep_score'),
      buildColumn('rem_score', 'sleep_rem_score'),
      buildColumn('latency_score', 'sleep_latency_score'),
      buildColumn('total_sleep_time_score', 'sleep_total_time_score'),
      buildColumn('movement_awakening', 'sleep_movement_awakening_count'),
    ],
  },
  'com.samsung.shealth.sleep_combined': {
    name: 'Sleep combined summary',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('sleep_score', 'sleep_combined_score'),
      buildColumn('sleep_duration', 'sleep_combined_duration_minutes'),
      buildColumn('total_light_duration', 'sleep_combined_light_duration_minutes'),
      buildColumn('total_rem_duration', 'sleep_combined_rem_duration_minutes'),
      buildColumn('sleep_cycle', 'sleep_combined_cycle_count'),
      buildColumn('efficiency', 'sleep_combined_efficiency_percent'),
      buildColumn('mental_recovery', 'sleep_combined_mental_recovery_score'),
      buildColumn('physical_recovery', 'sleep_combined_physical_recovery_score'),
      buildColumn('wake_score', 'sleep_combined_wake_score'),
      buildColumn('deep_score', 'sleep_combined_deep_score'),
      buildColumn('rem_score', 'sleep_combined_rem_score'),
      buildColumn('latency_score', 'sleep_combined_latency_score'),
      buildColumn('total_sleep_time_score', 'sleep_combined_total_time_score'),
      buildColumn('movement_awakening', 'sleep_combined_movement_awakening_count'),
    ],
  },
  'com.samsung.shealth.sleep_snoring': {
    name: 'Sleep snoring',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('duration', 'snoring_duration_seconds', 'durationMsToSeconds'),
    ],
  },
  'com.samsung.health.nutrition': {
    name: 'Nutrition',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('title', 'nutrition_meal', 'text'),
      buildColumn('calorie', 'nutrition_calories_kcal'),
      buildColumn('carbohydrate', 'nutrition_carbohydrate_g'),
      buildColumn('protein', 'nutrition_protein_g'),
      buildColumn('total_fat', 'nutrition_total_fat_g'),
      buildColumn('saturated_fat', 'nutrition_saturated_fat_g'),
      buildColumn('trans_fat', 'nutrition_trans_fat_g'),
      buildColumn('dietary_fiber', 'nutrition_dietary_fiber_g'),
      buildColumn('sugar', 'nutrition_sugar_g'),
      buildColumn('added_sugar', 'nutrition_added_sugar_g'),
      buildColumn('sodium', 'nutrition_sodium_mg'),
      buildColumn('cholesterol', 'nutrition_cholesterol_mg'),
      buildColumn('caffeine', 'nutrition_caffeine_mg'),
      buildColumn('calcium', 'nutrition_calcium_mg'),
      buildColumn('iron', 'nutrition_iron_mg'),
      buildColumn('potassium', 'nutrition_potassium_mg'),
      buildColumn('vitamin_a', 'nutrition_vitamin_a'),
      buildColumn('vitamin_c', 'nutrition_vitamin_c_mg'),
      buildColumn('vitamin_d', 'nutrition_vitamin_d'),
      buildColumn('vitamin_e', 'nutrition_vitamin_e_mg'),
      buildColumn('vitamin_b6', 'nutrition_vitamin_b6_mg'),
      buildColumn('vitamin_b12', 'nutrition_vitamin_b12'),
      buildColumn('magnesium', 'nutrition_magnesium_mg'),
      buildColumn('zinc', 'nutrition_zinc_mg'),
    ],
  },
  'com.samsung.health.food_intake': {
    name: 'Food intake',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('name', 'food_name', 'text'),
      buildColumn('amount', 'food_amount'),
      buildColumn('unit', 'food_unit', 'text'),
      buildColumn('calorie', 'food_calories_kcal'),
    ],
  },
  'com.samsung.shealth.calories_burned.details': {
    name: 'Calories burned',
    timestampColumn: 'com.samsung.shealth.calories_burned.day_time',
    timestampKind: 'day',
    idColumn: 'com.samsung.shealth.calories_burned.datauuid',
    prefixedName: 'com.samsung.shealth.calories_burned',
    columns: [
      buildColumn('com.samsung.shealth.calories_burned.active_calorie', 'calories_active_kcal'),
      buildColumn('com.samsung.shealth.calories_burned.rest_calorie', 'calories_resting_kcal'),
      buildColumn('com.samsung.shealth.calories_burned.tef_calorie', 'calories_thermic_food_kcal'),
      buildColumn('exercise_calories', 'calories_exercise_kcal'),
      buildColumn('total_exercise_calories', 'calories_total_exercise_kcal'),
      buildColumn('com.samsung.shealth.calories_burned.active_time', 'calories_active_time_minutes', 'durationMsToMinutes'),
    ],
  },
  'com.samsung.shealth.exercise': {
    name: 'Exercise',
    timestampColumn: 'com.samsung.health.exercise.start_time',
    timeOffsetColumn: 'com.samsung.health.exercise.time_offset',
    idColumn: 'com.samsung.health.exercise.datauuid',
    prefixedName: 'com.samsung.health.exercise',
    columns: [
      buildColumn('title', 'exercise_title', 'text'),
      buildColumn('com.samsung.health.exercise.duration', 'exercise_duration_minutes', 'durationMsToMinutes'),
      buildColumn('com.samsung.health.exercise.distance', 'exercise_distance_m'),
      buildColumn('com.samsung.health.exercise.calorie', 'exercise_calories_kcal'),
      buildColumn('com.samsung.health.exercise.mean_heart_rate', 'exercise_mean_heart_rate_bpm', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.exercise.min_heart_rate', 'exercise_min_heart_rate_bpm', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.exercise.max_heart_rate', 'exercise_max_heart_rate_bpm', 'number', { skipZero: true }),
      buildColumn('com.samsung.health.exercise.mean_speed', 'exercise_mean_speed_mps'),
      buildColumn('com.samsung.health.exercise.max_speed', 'exercise_max_speed_mps'),
      buildColumn('com.samsung.health.exercise.vo2_max', 'exercise_vo2_max'),
      buildColumn('com.samsung.health.exercise.count', 'exercise_count'),
      buildColumn('com.samsung.health.exercise.altitude_gain', 'exercise_altitude_gain_m'),
      buildColumn('com.samsung.health.exercise.altitude_loss', 'exercise_altitude_loss_m'),
      buildColumn('com.samsung.health.exercise.sweat_loss', 'exercise_sweat_loss_ml'),
      buildColumn('heart_rate_sample_count', 'exercise_heart_rate_sample_count'),
    ],
  },
  'com.samsung.shealth.mindfulness.history': {
    name: 'Mindfulness',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('duration', 'mindfulness_duration_minutes', 'durationMsToMinutes'),
      buildColumn('mood', 'mindfulness_mood'),
      buildColumn('program_title', 'mindfulness_program', 'text'),
      buildColumn('track_title', 'mindfulness_track', 'text'),
    ],
  },
  'com.samsung.shealth.alerted_heart_rate': {
    name: 'Alerted heart rate',
    timestampColumn: 'start_time',
    columns: [
      buildColumn('heart_rate', 'alerted_heart_rate_bpm', 'number', { skipZero: true }),
      buildColumn('min', 'alerted_heart_rate_min_bpm', 'number', { skipZero: true }),
      buildColumn('max', 'alerted_heart_rate_max_bpm', 'number', { skipZero: true }),
      buildColumn('threshold', 'alerted_heart_rate_threshold_bpm', 'number', { skipZero: true }),
    ],
  },
};

Object.entries(samsungDatasetRules).forEach(([datasetName, rule]) => {
  rule.datasetName = datasetName;
});

const skippedDatasetReasons = {
  'com.samsung.health.device_profile': 'Device metadata is not a personal measurement.',
  'com.samsung.health.user_profile': 'Profile/settings data is not imported as measurements.',
  'com.samsung.shealth.preferences': 'App preferences are not personal measurements.',
  'com.samsung.shealth.service_preferences': 'Service preferences are not personal measurements.',
  'com.samsung.shealth.badge': 'Badge/achievement metadata is not imported.',
  'com.samsung.shealth.social.service_status': 'Service status metadata is not imported.',
  'com.samsung.shealth.program.sleep_coaching.mission': 'Sleep coaching task metadata is not imported.',
  'com.samsung.shealth.program.sleep_coaching.session': 'Sleep coaching session metadata is not imported.',
  'com.samsung.shealth.exercise.periodization_training_schedule': 'Training schedule metadata is not imported.',
  'com.samsung.shealth.exercise.periodization_training_program': 'Training program metadata is not imported.',
  'com.samsung.shealth.sleep_raw_data': 'Raw encoded sleep payloads need a dedicated decoder before import.',
  'com.samsung.shealth.stress.histogram': 'Encoded stress histograms need a dedicated decoder before import.',
  'com.samsung.shealth.exercise.weather': 'Weather context is not a personal measurement.',
  'com.samsung.shealth.sleep_goal': 'Goal settings are not imported as measurements.',
  'com.samsung.shealth.food_goal': 'Goal settings are not imported as measurements.',
  'com.samsung.shealth.activity.daily_goal': 'Goal settings are not imported as measurements.',
  'com.samsung.shealth.active_calories.goal': 'Goal settings are not imported as measurements.',
  'com.samsung.shealth.tracker.pedometer_recommendation': 'Recommendation settings are not imported as measurements.',
  'com.samsung.shealth.best_records': 'Best-record metadata has app-specific value codes and is skipped for now.',
};

const parseSamsungCsvText = async (text, entryName) => {
  const cleanText = stripBom(text);
  const firstNewline = cleanText.indexOf('\n');
  if (firstNewline === -1) {
    throw new Error(`Samsung Health CSV has no header row: ${entryName}`);
  }

  const metadataLine = cleanText.slice(0, firstNewline).replace(/\r$/, '');
  const datasetName = stripBom(metadataLine.split(',')[0]).trim();
  const csvBody = cleanText.slice(firstNewline + 1);
  const parsed = await parseCsvText(csvBody);
  return {
    datasetName,
    headers: parsed.headers,
    rows: parsed.rows,
  };
};

const buildSourceId = ({ datasetName, sourceFile, rowIndex, rowId, timestamp, label, value }) => {
  const identity = rowId || `${timestamp.toISOString()}::${label}::${value}::row-${rowIndex + 1}`;
  return `${SAMSUNG_SOURCE}:${datasetName}:${identity}:${label}`;
};

const buildValueFromColumn = ({ column, row, headers, datasetName, sourceFile, rowIndex, rowId, timestamp }) => {
  const rawValue = getRowValue(row, headers, column.source);
  const transformer = valueTransformers[column.parser || 'number'] || valueTransformers.number;
  const value = transformer(rawValue, row, headers);
  if (!value) return null;
  if (column.skipZero && Number(value) === 0) return null;

  const label = getLabelForColumn(column, rawValue, row, headers);
  if (!label) return null;

  return {
    source: column.source,
    label,
    type: 'basic',
    value,
    importSource: SAMSUNG_SOURCE,
    sourceId: buildSourceId({ datasetName, sourceFile, rowIndex, rowId, timestamp, label, value }),
    sourceFile,
  };
};

const summarizeFile = (entryName, datasetName, rule) => ({
  path: entryName,
  fileName: path.basename(entryName),
  datasetName,
  displayName: rule?.name || normalizeDatasetLabel(datasetName) || datasetName || path.basename(entryName),
  supported: Boolean(rule),
  skipReason: rule ? '' : (skippedDatasetReasons[datasetName] || 'No Samsung Health import rule exists for this CSV yet.'),
  rowCount: 0,
  eligibleRowCount: 0,
  beforeWindowRows: 0,
  afterWindowRows: 0,
  invalidRows: 0,
  emptyRows: 0,
  entryCount: 0,
  firstDate: '',
  lastDate: '',
  labels: [],
});

const addLabelSample = (fileSummary, label) => {
  if (!label || fileSummary.labels.includes(label)) return;
  if (fileSummary.labels.length >= MAX_SAMPLE_LABELS) return;
  fileSummary.labels.push(label);
};

const updateDateRange = (summary, date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
  if (!summary.firstTimestamp || date < summary.firstTimestamp) {
    summary.firstTimestamp = date;
  }
  if (!summary.lastTimestamp || date > summary.lastTimestamp) {
    summary.lastTimestamp = date;
  }
};

const finalizeDateRange = (summary) => {
  summary.firstDate = summary.firstTimestamp ? formatDateLocal(summary.firstTimestamp) : '';
  summary.lastDate = summary.lastTimestamp ? formatDateLocal(summary.lastTimestamp) : '';
  delete summary.firstTimestamp;
  delete summary.lastTimestamp;
};

const parseSamsungZip = async (buffer, {
  windowStart = null,
  windowEnd,
  includeRecords = false,
} = {}) => {
  const entries = listZipEntries(buffer);
  const csvEntries = entries.filter((entry) => (
    !entry.isDirectory
    && entry.name.toLowerCase().endsWith('.csv')
    && !entry.name.includes('/jsons/')
  ));
  const records = [];
  const summary = {
    formatId: 'samsung_health_zip',
    formatName: 'Samsung Health ZIP',
    source: SAMSUNG_SOURCE,
    csvFileCount: csvEntries.length,
    supportedFileCount: 0,
    skippedFileCount: 0,
    rowCount: 0,
    eligibleRowCount: 0,
    beforeWindowRows: 0,
    afterWindowRows: 0,
    invalidRows: 0,
    emptyRows: 0,
    records: includeRecords ? records : [],
    importableEntryCount: 0,
    files: [],
    unsupportedFiles: [],
    windowStart,
    windowEnd,
    windowStartDisplay: windowStart ? formatDateTimeLocal(windowStart) : 'Beginning of archive',
    windowEndDisplay: formatDateTimeLocal(windowEnd),
    firstDate: '',
    lastDate: '',
  };

  const seenSourceIds = new Set();

  for (const entry of csvEntries) {
    const text = extractZipEntry(buffer, entry).toString('utf8');
    const { datasetName, headers, rows } = await parseSamsungCsvText(text, entry.name);
    const rule = samsungDatasetRules[datasetName] || null;
    const fileSummary = summarizeFile(entry.name, datasetName, rule);
    fileSummary.rowCount = rows.length;
    summary.rowCount += rows.length;

    if (!rule) {
      summary.skippedFileCount += 1;
      summary.unsupportedFiles.push(fileSummary);
      summary.files.push(fileSummary);
      continue;
    }

    summary.supportedFileCount += 1;

    rows.forEach((row, rowIndex) => {
      const timestamp = getTimestampForRow(row, headers, rule);
      if (!timestamp) {
        fileSummary.invalidRows += 1;
        summary.invalidRows += 1;
        return;
      }
      if (windowStart && timestamp < windowStart) {
        fileSummary.beforeWindowRows += 1;
        summary.beforeWindowRows += 1;
        return;
      }
      if (timestamp > windowEnd) {
        fileSummary.afterWindowRows += 1;
        summary.afterWindowRows += 1;
        return;
      }

      const rowId = getDataUuid(row, headers, rule);
      const values = rule.columns
        .map((column) => buildValueFromColumn({
          column,
          row,
          headers,
          datasetName,
          sourceFile: entry.name,
          rowIndex,
          rowId,
          timestamp,
        }))
        .filter(Boolean)
        .filter((value) => {
          if (!value.sourceId) return true;
          if (seenSourceIds.has(value.sourceId)) return false;
          seenSourceIds.add(value.sourceId);
          return true;
        });

      if (!values.length) {
        fileSummary.emptyRows += 1;
        summary.emptyRows += 1;
        return;
      }

      const dateKey = formatDateLocal(timestamp);
      const record = {
        sourceRow: `${entry.name}:${rowIndex + 3}`,
        sourceFile: entry.name,
        importSource: SAMSUNG_SOURCE,
        timestamp,
        dateKey,
        values,
      };

      fileSummary.eligibleRowCount += 1;
      fileSummary.entryCount += values.length;
      summary.eligibleRowCount += 1;
      summary.importableEntryCount += values.length;
      updateDateRange(fileSummary, timestamp);
      updateDateRange(summary, timestamp);
      values.forEach((value) => addLabelSample(fileSummary, value.label));
      if (includeRecords) {
        records.push(record);
      }
    });

    finalizeDateRange(fileSummary);
    summary.files.push(fileSummary);
  }

  finalizeDateRange(summary);
  return summary;
};

class MyLifeLogSamsungHealthImportService {
  constructor({ ImportState = MyLifeLogImportState } = {}) {
    this.ImportState = ImportState;
  }

  async getState() {
    return this.ImportState.findOne({ source: SAMSUNG_SOURCE }).lean();
  }

  async getImportWindow({ now = new Date() } = {}) {
    const state = await this.getState();
    const windowStart = state?.importedThrough ? addOneMillisecond(state.importedThrough) : null;
    const windowEnd = getLastFullDayEnd(now);
    return {
      state,
      windowStart,
      windowEnd,
      windowStartDisplay: windowStart ? formatDateTimeLocal(windowStart) : 'Beginning of archive',
      windowEndDisplay: formatDateTimeLocal(windowEnd),
    };
  }

  async buildPreview(buffer, { now = new Date(), fileName = '' } = {}) {
    const importWindow = await this.getImportWindow({ now });
    const preview = await parseSamsungZip(buffer, {
      windowStart: importWindow.windowStart,
      windowEnd: importWindow.windowEnd,
      includeRecords: false,
    });
    await this.ImportState.findOneAndUpdate(
      { source: SAMSUNG_SOURCE },
      {
        $set: {
          source: SAMSUNG_SOURCE,
          lastFileName: fileName,
          lastPreviewedAt: now,
        },
        $setOnInsert: {
          importedThrough: null,
        },
      },
      { upsert: true }
    );
    return {
      ...preview,
      state: importWindow.state,
      checkpointDisplay: importWindow.state?.importedThrough
        ? formatDateTimeLocal(importWindow.state.importedThrough)
        : '',
    };
  }

  async buildImportRecords(buffer, { now = new Date() } = {}) {
    const importWindow = await this.getImportWindow({ now });
    const parsedImport = await parseSamsungZip(buffer, {
      windowStart: importWindow.windowStart,
      windowEnd: importWindow.windowEnd,
      includeRecords: true,
    });
    return {
      ...parsedImport,
      state: importWindow.state,
      checkpointDisplay: importWindow.state?.importedThrough
        ? formatDateTimeLocal(importWindow.state.importedThrough)
        : '',
    };
  }

  async markImportComplete({ importedThrough, fileName = '', result = null, now = new Date() } = {}) {
    if (!(importedThrough instanceof Date) || Number.isNaN(importedThrough.getTime())) {
      return null;
    }
    return this.ImportState.findOneAndUpdate(
      { source: SAMSUNG_SOURCE },
      {
        $set: {
          source: SAMSUNG_SOURCE,
          importedThrough,
          lastFileName: fileName,
          lastImportedAt: now,
          lastImportSummary: result,
        },
      },
      { upsert: true, new: true }
    );
  }
}

const service = new MyLifeLogSamsungHealthImportService();

module.exports = service;
module.exports.MyLifeLogSamsungHealthImportService = MyLifeLogSamsungHealthImportService;
module.exports.SAMSUNG_SOURCE = SAMSUNG_SOURCE;
module.exports.getLastFullDayEnd = getLastFullDayEnd;
module.exports.listZipEntries = listZipEntries;
module.exports.extractZipEntry = extractZipEntry;
module.exports.parseSamsungZip = parseSamsungZip;
