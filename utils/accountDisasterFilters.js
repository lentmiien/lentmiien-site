// Pure dashboard filter parity with the existing Disaster Watch regional policy.
const DASHBOARD_SCOPE_CHAIN = ['横浜旭区', '横浜', '神奈川県'];
const DASHBOARD_TARGET_LOCATION = {
  name: '横浜旭区',
  latitude: 35.4759,
  longitude: 139.5443,
};
const DEFAULT_TYPHOON_WATCH_RADIUS_KM = 900;
const TYPHOON_EFFECT_REGIONS = [
  '神奈川県',
  '横浜',
  '東京都',
  '千葉県',
  '埼玉県',
  '山梨県',
  '静岡県',
  '関東甲信',
  '東京地方',
  '伊豆諸島',
];
const TYPHOON_EFFECT_TERMS = [
  '台風',
  '暴風',
  '強風',
  '高波',
  '大雨',
  '土砂',
  '浸水',
  '河川',
  '氾濫',
  '竜巻',
  '落雷',
];

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termsRegex(terms) {
  return new RegExp(terms.map(escapeRegex).join('|'), 'i');
}

function typhoonWatchRadiusKm() {
  return parsePositiveInteger(process.env.DISASTER_TYPHOON_WATCH_RADIUS_KM, DEFAULT_TYPHOON_WATCH_RADIUS_KM);
}

function coordinateBounds(center, radiusKm) {
  const latitudeDelta = radiusKm / 111;
  const longitudeDelta = radiusKm / (111 * Math.max(0.25, Math.cos(center.latitude * Math.PI / 180)));
  return {
    minLatitude: center.latitude - latitudeDelta,
    maxLatitude: center.latitude + latitudeDelta,
    minLongitude: center.longitude - longitudeDelta,
    maxLongitude: center.longitude + longitudeDelta,
  };
}

function timeWindowFilter(since) {
  return {
    $or: [
      { eventAt: { $gte: since } },
      { reportAt: { $gte: since } },
      { entryUpdatedAt: { $gte: since } },
      { createdAt: { $gte: since } },
    ],
  };
}

function scopeFilter(scope) {
  const regex = new RegExp(escapeRegex(scope), 'i');
  const filters = [
    { 'areas.name': regex },
    { 'areas.prefecture': regex },
    { 'weather.areaNames': regex },
    { 'typhoon.affectedAreas.name': regex },
    { 'typhoon.affectedAreas.prefecture': regex },
    { title: regex },
    { headline: regex },
    { sourceEntryContent: regex },
  ];

  if (scope === '横浜旭区') {
    filters.push({
      category: 'earthquake',
      'earthquake.yokohamaAsahiIntensity': { $nin: ['0', '', null] },
    });
  }

  return { $or: filters };
}

function typhoonTrackFilter(radiusKm = typhoonWatchRadiusKm()) {
  const bounds = coordinateBounds(DASHBOARD_TARGET_LOCATION, radiusKm);
  return {
    category: 'typhoon',
    'typhoon.track': {
      $elemMatch: {
        latitude: { $gte: bounds.minLatitude, $lte: bounds.maxLatitude },
        longitude: { $gte: bounds.minLongitude, $lte: bounds.maxLongitude },
      },
    },
  };
}

function typhoonEffectWeatherFilter() {
  const regionRegex = termsRegex(TYPHOON_EFFECT_REGIONS);
  const effectRegex = termsRegex(TYPHOON_EFFECT_TERMS);
  return {
    category: { $in: ['extreme_weather', 'flood', 'landslide', 'tornado'] },
    $and: [
      {
        $or: [
          { 'areas.name': regionRegex },
          { 'areas.prefecture': regionRegex },
          { 'weather.areaNames': regionRegex },
          { title: regionRegex },
          { headline: regionRegex },
          { sourceEntryContent: regionRegex },
        ],
      },
      {
        $or: [
          { 'hazards.name': effectRegex },
          { 'weather.hazardNames': effectRegex },
          { title: effectRegex },
          { headline: effectRegex },
          { sourceEntryContent: effectRegex },
        ],
      },
    ],
  };
}

function regionalTyphoonTextFilter() {
  const regionRegex = termsRegex(TYPHOON_EFFECT_REGIONS);
  const effectRegex = termsRegex(TYPHOON_EFFECT_TERMS);
  return {
    category: 'typhoon',
    $and: [
      {
        $or: [
          { 'areas.name': regionRegex },
          { 'areas.prefecture': regionRegex },
          { 'weather.areaNames': regionRegex },
          { title: regionRegex },
          { headline: regionRegex },
          { sourceEntryContent: regionRegex },
        ],
      },
      {
        $or: [
          { title: effectRegex },
          { headline: effectRegex },
          { sourceEntryContent: effectRegex },
        ],
      },
    ],
  };
}

function dashboardFilter(scope, since) {
  return {
    $and: [
      timeWindowFilter(since),
      {
        $or: [
          scopeFilter(scope),
          typhoonTrackFilter(),
          regionalTyphoonTextFilter(),
          typhoonEffectWeatherFilter(),
        ],
      },
    ],
  };
}

module.exports = { DASHBOARD_SCOPE_CHAIN, dashboardFilter };
