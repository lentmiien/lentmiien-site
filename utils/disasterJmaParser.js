const { XMLParser } = require('fast-xml-parser');

const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
};

const parser = new XMLParser(XML_OPTIONS);

const EARTHQUAKE_TARGET_AREA = '横浜旭区';

function asArray(value) {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function cleanString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const stringValue = String(value).replace(/\s+/g, ' ').trim();
  return stringValue || null;
}

function textValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return cleanString(value);
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, '#text')) {
      return cleanString(value['#text']);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Name')) {
      return textValue(value.Name);
    }
  }
  return null;
}

function numberValue(value) {
  const stringValue = textValue(value);
  if (!stringValue || stringValue === 'NaN' || stringValue === '不明') {
    return null;
  }
  const normalized = stringValue
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xFF10))
    .replace('．', '.')
    .replace(/[^\d.+-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  const stringValue = textValue(value);
  if (!stringValue) {
    return null;
  }
  const date = new Date(stringValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseXml(xmlText) {
  return parser.parse(xmlText);
}

function getLinkHref(linkValue) {
  const links = asArray(linkValue);
  const xmlLink = links.find((link) => {
    if (!link || typeof link !== 'object') {
      return false;
    }
    return link['@_type'] === 'application/xml' && link['@_href'];
  });
  const firstWithHref = links.find((link) => link && typeof link === 'object' && link['@_href']);
  return xmlLink?.['@_href'] || firstWithHref?.['@_href'] || null;
}

function parseAtomFeed(xmlText, feedUrl = null) {
  const parsed = parseXml(xmlText);
  const feed = parsed.feed || {};
  const entries = asArray(feed.entry).map((entry) => ({
    id: textValue(entry.id),
    title: textValue(entry.title),
    updatedAt: parseDate(entry.updated),
    author: textValue(entry.author?.name),
    url: getLinkHref(entry.link) || textValue(entry.id),
    content: textValue(entry.content),
  })).filter((entry) => entry.id || entry.url);

  return {
    url: feedUrl,
    id: textValue(feed.id),
    title: textValue(feed.title),
    updatedAt: parseDate(feed.updated),
    entries,
  };
}

function collectByKey(node, key, output = []) {
  if (node === null || node === undefined) {
    return output;
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => collectByKey(entry, key, output));
    return output;
  }
  if (typeof node !== 'object') {
    return output;
  }
  Object.entries(node).forEach(([entryKey, entryValue]) => {
    if (entryKey === key) {
      output.push(entryValue);
    }
    collectByKey(entryValue, key, output);
  });
  return output;
}

function first(value) {
  return asArray(value)[0] || null;
}

function uniqueBy(items, keyBuilder) {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    const key = keyBuilder(item);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(item);
  });
  return output;
}

function parseCoordinate(coordinateNode) {
  const rawValue = textValue(coordinateNode);
  const description = cleanString(coordinateNode?.['@_description']);
  if (!rawValue) {
    return {
      latitude: null,
      longitude: null,
      depthKm: null,
      coordinateDescription: description,
    };
  }

  const match = rawValue.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\//);
  if (!match) {
    return {
      latitude: null,
      longitude: null,
      depthKm: null,
      coordinateDescription: description,
    };
  }

  const depthMeters = match[3] ? Number.parseFloat(match[3]) : null;
  return {
    latitude: Number.parseFloat(match[1]),
    longitude: Number.parseFloat(match[2]),
    depthKm: Number.isFinite(depthMeters) ? Math.abs(depthMeters) / 1000 : null,
    coordinateDescription: description,
  };
}

function shindoScore(value) {
  const label = textValue(value);
  if (!label) {
    return 0;
  }
  const scores = {
    '0': 0,
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5-': 5,
    '5+': 5.5,
    '6-': 6,
    '6+': 6.5,
    '7': 7,
  };
  return scores[label] || numberValue(label) || 0;
}

function normalizeShindoLabel(value) {
  return textValue(value) || '0';
}

function collectIntensityAreas(observation) {
  const areas = [];
  asArray(observation?.Pref).forEach((pref) => {
    const prefName = textValue(pref.Name);
    const prefCode = textValue(pref.Code);
    if (prefName) {
      areas.push({
        name: prefName,
        code: prefCode,
        codeType: '地震情報／都道府県等',
        maxIntensity: normalizeShindoLabel(pref.MaxInt),
      });
    }

    asArray(pref.Area).forEach((area) => {
      const areaName = textValue(area.Name);
      const areaCode = textValue(area.Code);
      if (areaName) {
        areas.push({
          name: areaName,
          code: areaCode,
          codeType: '地震情報／細分区域',
          prefecture: prefName,
          prefectureCode: prefCode,
          maxIntensity: normalizeShindoLabel(area.MaxInt),
        });
      }

      asArray(area.City).forEach((city) => {
        const cityName = textValue(city.Name);
        const cityCode = textValue(city.Code);
        if (cityName) {
          areas.push({
            name: cityName,
            code: cityCode,
            codeType: '気象・地震・火山情報／市町村等',
            prefecture: prefName,
            prefectureCode: prefCode,
            maxIntensity: normalizeShindoLabel(city.MaxInt),
          });
        }
      });
    });
  });
  return areas;
}

function findTargetIntensity(observation, targetArea = EARTHQUAKE_TARGET_AREA) {
  let best = {
    label: '0',
    score: 0,
  };

  asArray(observation?.Pref).forEach((pref) => {
    asArray(pref.Area).forEach((area) => {
      asArray(area.City).forEach((city) => {
        const cityName = textValue(city.Name);
        const cityIntensity = normalizeShindoLabel(city.MaxInt);
        if (cityName && cityName.includes(targetArea) && shindoScore(cityIntensity) > best.score) {
          best = { label: cityIntensity, score: shindoScore(cityIntensity) };
        }

        asArray(city.IntensityStation).forEach((station) => {
          const stationName = textValue(station.Name);
          const stationIntensity = normalizeShindoLabel(station.Int);
          if (stationName && stationName.includes(targetArea) && shindoScore(stationIntensity) > best.score) {
            best = { label: stationIntensity, score: shindoScore(stationIntensity) };
          }
        });
      });
    });
  });

  return best.label;
}

function extractEarthquake(report) {
  const body = report.Body || {};
  const earthquake = first(body.Earthquake);
  const hypocenterArea = earthquake?.Hypocenter?.Area || {};
  const coordinate = parseCoordinate(hypocenterArea.Coordinate);
  const magnitude = earthquake?.Magnitude || null;
  const observation = body.Intensity?.Observation || {};
  const maxIntensity = normalizeShindoLabel(observation.MaxInt);
  const comments = collectByKey(body.Comments || {}, 'Text').map(textValue).filter(Boolean);

  if (!earthquake && !observation.MaxInt) {
    return {
      earthquake: {
        yokohamaAsahiIntensity: '0',
        yokohamaAsahiIntensityLabel: '0',
      },
      areas: [],
    };
  }

  return {
    earthquake: {
      originTime: parseDate(earthquake?.OriginTime),
      arrivalTime: parseDate(earthquake?.ArrivalTime),
      hypocenterName: textValue(hypocenterArea.Name),
      hypocenterCode: textValue(hypocenterArea.Code),
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      depthKm: coordinate.depthKm,
      coordinateDescription: coordinate.coordinateDescription,
      magnitude: numberValue(magnitude),
      magnitudeType: cleanString(magnitude?.['@_type']),
      magnitudeDescription: cleanString(magnitude?.['@_description']),
      maxIntensity,
      maxIntensityLabel: maxIntensity,
      yokohamaAsahiIntensity: findTargetIntensity(observation),
      yokohamaAsahiIntensityLabel: findTargetIntensity(observation),
      tsunamiComment: comments.find((comment) => comment.includes('津波')) || null,
    },
    areas: collectIntensityAreas(observation),
  };
}

function extractHeadlineInformation(head) {
  const hazards = [];
  const areas = [];
  const headline = head?.Headline || {};

  asArray(headline.Information).forEach((information) => {
    const type = cleanString(information?.['@_type']);
    asArray(information?.Item).forEach((item) => {
      const kinds = asArray(item.Kind).map((kind) => ({
        name: textValue(kind.Name) || textValue(kind.Property?.Type),
        code: textValue(kind.Code),
        type,
        status: textValue(kind.Status),
      })).filter((kind) => kind.name);

      kinds.forEach((kind) => hazards.push(kind));

      const areaContainers = [
        ...asArray(item.Areas),
        ...asArray(item.Area),
      ];
      areaContainers.forEach((container) => {
        asArray(container.Area || container).forEach((area) => {
          const areaName = textValue(area.Name);
          if (!areaName) {
            return;
          }
          areas.push({
            name: areaName,
            code: textValue(area.Code),
            codeType: cleanString(container?.['@_codeType']) || type,
            prefecture: textValue(area.Prefecture),
            prefectureCode: textValue(area.PrefectureCode),
            kinds: kinds.map((kind) => kind.name),
          });
        });
      });
    });
  });

  return {
    hazards: uniqueBy(hazards, (hazard) => `${hazard.name || ''}:${hazard.code || ''}:${hazard.type || ''}`),
    areas: uniqueBy(areas, (area) => `${area.name || ''}:${area.code || ''}:${area.codeType || ''}`),
  };
}

function parseIsoDurationHours(value) {
  const duration = textValue(value);
  if (!duration) {
    return null;
  }
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1] || '0', 10);
  const minutes = Number.parseInt(match[2] || '0', 10);
  return hours + (minutes / 60);
}

function extractTyphoon(report) {
  const body = report.Body || {};
  const typhoonNamePart = first(collectByKey(body, 'TyphoonNamePart'));
  const typhoon = {
    name: textValue(typhoonNamePart?.Name),
    nameKana: textValue(typhoonNamePart?.NameKana),
    number: textValue(typhoonNamePart?.Number),
    maxWindProbability: null,
    maxWindProbabilityArea: null,
    forecastWindowHours: parseIsoDurationHours(report.Head?.TargetDuration),
    affectedAreas: [],
    track: [],
  };

  collectByKey(body, 'MeteorologicalInfo').flatMap(asArray).forEach((info) => {
    const infoWindowHours = parseIsoDurationHours(info.Duration);
    asArray(info.Item).forEach((item) => {
      const probabilityNode = first(collectByKey(item, 'FiftyKtWindProbability'));
      const probability = numberValue(probabilityNode);
      if (probability === null) {
        return;
      }
      const area = first(item.Area) || item.Area || {};
      const areaName = textValue(area.Name);
      const affectedArea = {
        name: areaName,
        code: textValue(area.Code),
        prefecture: textValue(area.Prefecture),
        prefectureCode: textValue(area.PrefectureCode),
        probability,
        windowHours: infoWindowHours,
        windowName: textValue(info.Name),
      };

      if (typhoon.maxWindProbability === null || probability > typhoon.maxWindProbability) {
        typhoon.maxWindProbability = probability;
        typhoon.maxWindProbabilityArea = areaName;
      }
      if (probability > 0) {
        typhoon.affectedAreas.push(affectedArea);
      }
    });
  });

  typhoon.affectedAreas = typhoon.affectedAreas
    .sort((a, b) => (b.probability || 0) - (a.probability || 0))
    .slice(0, 30);

  typhoon.track = collectByKey(body, 'Coordinate')
    .map((coordinateNode) => {
      const coordinate = parseCoordinate(coordinateNode);
      return {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        depthKm: coordinate.depthKm,
        description: coordinate.coordinateDescription,
      };
    })
    .filter((coordinate) => Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude))
    .slice(0, 30);

  return typhoon;
}

function classifyDisaster({ title, infoKind, headline }) {
  const source = [title, infoKind, headline].filter(Boolean).join(' ');
  if (/台風/.test(source)) return 'typhoon';
  if (/津波/.test(source)) return 'tsunami';
  if (/震源|震度|地震|長周期地震動/.test(source)) return 'earthquake';
  if (/洪水|氾濫/.test(source)) return 'flood';
  if (/土砂/.test(source)) return 'landslide';
  if (/竜巻|突風/.test(source)) return 'tornado';
  if (/火山|噴火/.test(source)) return 'volcano';
  if (/降灰/.test(source)) return 'ashfall';
  if (/気象|警報|注意報|大雨|暴風|強風|高波|雷|大雪|熱中症/.test(source)) return 'extreme_weather';
  return 'other';
}

function severityFromText({ category, title, headline, hazards, earthquake }) {
  const source = [
    title,
    headline,
    ...hazards.map((hazard) => hazard.name),
  ].filter(Boolean).join(' ');

  if (/解除/.test(source)) {
    return { severity: 'cleared', severityScore: 0 };
  }
  if (/特別警報|警戒レベル5|大津波警報/.test(source)) {
    return { severity: 'emergency', severityScore: 5 };
  }
  if (/警戒レベル4|警報|土砂災害警戒情報|氾濫危険/.test(source)) {
    return { severity: 'warning', severityScore: 4 };
  }
  if (/警戒レベル3|注意報|氾濫注意/.test(source)) {
    return { severity: 'advisory', severityScore: 2 };
  }
  if (category === 'earthquake') {
    const intensityScore = shindoScore(earthquake?.maxIntensity);
    const magnitude = earthquake?.magnitude || 0;
    if (intensityScore >= 5 || magnitude >= 6) {
      return { severity: 'warning', severityScore: 4 };
    }
    if (intensityScore >= 3 || magnitude >= 4) {
      return { severity: 'advisory', severityScore: 2 };
    }
  }
  if (category === 'typhoon') {
    return { severity: 'watch', severityScore: 3 };
  }
  return { severity: 'info', severityScore: 1 };
}

function buildWeatherDetails(hazards, areas) {
  const hazardNames = uniqueBy(hazards.map((hazard) => hazard.name).filter(Boolean), (name) => name);
  const areaNames = uniqueBy(areas.map((area) => area.name).filter(Boolean), (name) => name);
  return {
    hazardNames,
    areaNames,
    primaryArea: areaNames[0] || null,
    maxSeverityLabel: hazardNames.find((name) => /特別警報/.test(name))
      || hazardNames.find((name) => /警報/.test(name))
      || hazardNames.find((name) => /注意報/.test(name))
      || hazardNames[0]
      || null,
  };
}

function parseJmaAlert({ xmlText, entry = {}, feed = {} }) {
  const parsed = parseXml(xmlText);
  const report = parsed.Report || {};
  const control = report.Control || {};
  const head = report.Head || {};
  const title = textValue(head.Title) || textValue(control.Title) || entry.title || null;
  const headline = textValue(head.Headline?.Text) || entry.content || null;
  const infoKind = textValue(head.InfoKind);
  const headlineInfo = extractHeadlineInformation(head);
  const earthquakeDetails = extractEarthquake(report);
  const category = classifyDisaster({ title, infoKind, headline });
  const typhoon = category === 'typhoon' ? extractTyphoon(report) : {};
  const areas = uniqueBy(
    [
      ...headlineInfo.areas,
      ...earthquakeDetails.areas,
    ],
    (area) => `${area.name || ''}:${area.code || ''}:${area.codeType || ''}`
  );
  const hazards = headlineInfo.hazards;
  const severity = severityFromText({
    category,
    title,
    headline,
    hazards,
    earthquake: earthquakeDetails.earthquake,
  });
  const reportAt = parseDate(head.ReportDateTime);
  const targetAt = parseDate(head.TargetDateTime);
  const eventAt = earthquakeDetails.earthquake?.originTime || targetAt || reportAt || entry.updatedAt || null;

  return {
    source: 'jma',
    sourceId: entry.id || entry.url || null,
    sourceUrl: entry.url || entry.id || null,
    sourceFeedUrl: feed.url || null,
    sourceFeedTitle: feed.title || null,
    sourceEntryTitle: entry.title || null,
    sourceEntryContent: entry.content || null,
    author: entry.author || null,
    category,
    ...severity,
    confidence: 0.72,
    title,
    headline,
    summary: headline || title,
    status: textValue(control.Status),
    infoType: textValue(head.InfoType),
    infoKind,
    infoKindVersion: textValue(head.InfoKindVersion),
    eventId: textValue(head.EventID),
    serial: textValue(head.Serial),
    editorialOffice: textValue(control.EditorialOffice),
    publishingOffice: textValue(control.PublishingOffice),
    entryUpdatedAt: entry.updatedAt || null,
    reportAt,
    targetAt,
    eventAt,
    controlAt: parseDate(control.DateTime),
    detailFetchedAt: new Date(),
    areas,
    hazards,
    earthquake: earthquakeDetails.earthquake,
    typhoon,
    weather: buildWeatherDetails(hazards, areas),
    rawXmlSizeBytes: Buffer.byteLength(xmlText || '', 'utf8'),
    raw: report,
    parserVersion: 'jma-v1',
  };
}

module.exports = {
  EARTHQUAKE_TARGET_AREA,
  asArray,
  cleanString,
  collectByKey,
  numberValue,
  parseAtomFeed,
  parseCoordinate,
  parseDate,
  parseJmaAlert,
  parseXml,
  shindoScore,
  textValue,
};
