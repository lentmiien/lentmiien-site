const mongoose = require('mongoose');

const { Schema } = mongoose;

const DisasterWeatherObservationSchema = new Schema({
  observationKey: { type: String, required: true, unique: true, index: true },
  source: { type: String, required: true, trim: true, index: true },
  locationName: { type: String, required: true, trim: true, index: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  observedAt: { type: Date, required: true, index: true },
  bucketStartAt: { type: Date, required: true, index: true },
  temperatureC: { type: Number, default: null },
  feelsLikeC: { type: Number, default: null },
  precipitationMm: { type: Number, default: null },
  precipitationProbability: { type: Number, default: null },
  windSpeedMs: { type: Number, default: null },
  windGustMs: { type: Number, default: null },
  humidityPercent: { type: Number, default: null },
  pressureHpa: { type: Number, default: null },
  weatherCode: { type: String, trim: true, default: null },
  description: { type: String, trim: true, default: null },
  summary: { type: String, trim: true, default: null },
  raw: { type: Schema.Types.Mixed, default: {} },
}, {
  minimize: false,
  timestamps: true,
});

DisasterWeatherObservationSchema.index({ locationName: 1, bucketStartAt: -1 });

module.exports = mongoose.model(
  'disaster_weather_observation',
  DisasterWeatherObservationSchema,
  'disaster_weather_observations'
);
