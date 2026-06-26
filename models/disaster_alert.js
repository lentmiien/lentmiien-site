const mongoose = require('mongoose');

const { Schema } = mongoose;

const DisasterAreaSchema = new Schema({
  name: { type: String, trim: true, default: null },
  code: { type: String, trim: true, default: null },
  codeType: { type: String, trim: true, default: null },
  prefecture: { type: String, trim: true, default: null },
  prefectureCode: { type: String, trim: true, default: null },
  maxIntensity: { type: String, trim: true, default: null },
  kinds: { type: [String], default: [] },
}, { _id: false });

const DisasterHazardSchema = new Schema({
  name: { type: String, trim: true, default: null },
  code: { type: String, trim: true, default: null },
  type: { type: String, trim: true, default: null },
  status: { type: String, trim: true, default: null },
}, { _id: false });

const DisasterVerificationSchema = new Schema({
  source: { type: String, required: true, trim: true },
  checkedAt: { type: Date, default: Date.now },
  status: { type: String, trim: true, default: 'unknown' },
  matched: { type: Boolean, default: false },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  note: { type: String, trim: true, default: null },
  raw: { type: Schema.Types.Mixed, default: {} },
}, { _id: false, minimize: false });

const DisasterAlertSchema = new Schema({
  dedupeKey: { type: String, required: true, unique: true, index: true },
  source: { type: String, required: true, trim: true, index: true },
  sourceId: { type: String, trim: true, default: null, index: true },
  sourceUrl: { type: String, trim: true, default: null },
  sourceFeedUrl: { type: String, trim: true, default: null },
  sourceFeedTitle: { type: String, trim: true, default: null },
  sourceEntryTitle: { type: String, trim: true, default: null },
  sourceEntryContent: { type: String, trim: true, default: null },
  author: { type: String, trim: true, default: null },

  category: { type: String, required: true, trim: true, default: 'other', index: true },
  severity: { type: String, trim: true, default: 'info', index: true },
  severityScore: { type: Number, default: 0, index: true },
  confidence: { type: Number, min: 0, max: 1, default: 0.6 },

  title: { type: String, trim: true, default: null },
  headline: { type: String, trim: true, default: null },
  summary: { type: String, trim: true, default: null },
  status: { type: String, trim: true, default: null },
  infoType: { type: String, trim: true, default: null },
  infoKind: { type: String, trim: true, default: null },
  infoKindVersion: { type: String, trim: true, default: null },
  eventId: { type: String, trim: true, default: null, index: true },
  serial: { type: String, trim: true, default: null },
  editorialOffice: { type: String, trim: true, default: null },
  publishingOffice: { type: String, trim: true, default: null },

  entryUpdatedAt: { type: Date, default: null, index: true },
  reportAt: { type: Date, default: null, index: true },
  targetAt: { type: Date, default: null },
  eventAt: { type: Date, default: null, index: true },
  controlAt: { type: Date, default: null },
  detailFetchedAt: { type: Date, default: null },

  areas: { type: [DisasterAreaSchema], default: [] },
  hazards: { type: [DisasterHazardSchema], default: [] },

  earthquake: {
    originTime: { type: Date, default: null },
    arrivalTime: { type: Date, default: null },
    hypocenterName: { type: String, trim: true, default: null },
    hypocenterCode: { type: String, trim: true, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    depthKm: { type: Number, default: null },
    coordinateDescription: { type: String, trim: true, default: null },
    magnitude: { type: Number, default: null },
    magnitudeType: { type: String, trim: true, default: null },
    magnitudeDescription: { type: String, trim: true, default: null },
    maxIntensity: { type: String, trim: true, default: null },
    maxIntensityLabel: { type: String, trim: true, default: null },
    yokohamaAsahiIntensity: { type: String, trim: true, default: '0' },
    yokohamaAsahiIntensityLabel: { type: String, trim: true, default: '0' },
    tsunamiComment: { type: String, trim: true, default: null },
  },

  typhoon: {
    name: { type: String, trim: true, default: null },
    nameKana: { type: String, trim: true, default: null },
    number: { type: String, trim: true, default: null },
    maxWindProbability: { type: Number, default: null },
    maxWindProbabilityArea: { type: String, trim: true, default: null },
    forecastWindowHours: { type: Number, default: null },
    affectedAreas: { type: [Schema.Types.Mixed], default: [] },
    track: { type: [Schema.Types.Mixed], default: [] },
  },

  weather: {
    hazardNames: { type: [String], default: [] },
    areaNames: { type: [String], default: [] },
    primaryArea: { type: String, trim: true, default: null },
    maxSeverityLabel: { type: String, trim: true, default: null },
  },

  verifications: { type: [DisasterVerificationSchema], default: [] },
  rawXmlSizeBytes: { type: Number, default: 0 },
  raw: { type: Schema.Types.Mixed, default: {} },
  parserVersion: { type: String, trim: true, default: 'jma-v1' },
}, {
  minimize: false,
  timestamps: true,
});

DisasterAlertSchema.index({ category: 1, reportAt: -1 });
DisasterAlertSchema.index({ severityScore: -1, reportAt: -1 });
DisasterAlertSchema.index({ eventId: 1, source: 1 });

module.exports = mongoose.model('disaster_alert', DisasterAlertSchema, 'disaster_alerts');
