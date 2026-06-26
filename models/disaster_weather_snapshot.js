const mongoose = require('mongoose');

const { Schema } = mongoose;

const DisasterHourlyForecastSchema = new Schema({
  time: { type: Date, required: true },
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
}, { _id: false });

const DisasterWeatherSnapshotSchema = new Schema({
  source: { type: String, required: true, trim: true, index: true },
  locationName: { type: String, required: true, trim: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  fetchedAt: { type: Date, default: Date.now, index: true },
  forecastStartAt: { type: Date, default: null },
  forecastEndAt: { type: Date, default: null },
  summary: { type: String, trim: true, default: null },
  current: { type: Schema.Types.Mixed, default: {} },
  hourly: { type: [DisasterHourlyForecastSchema], default: [] },
  raw: { type: Schema.Types.Mixed, default: {} },
}, {
  minimize: false,
  timestamps: true,
});

DisasterWeatherSnapshotSchema.index({ locationName: 1, fetchedAt: -1 });

module.exports = mongoose.model('disaster_weather_snapshot', DisasterWeatherSnapshotSchema, 'disaster_weather_snapshots');
