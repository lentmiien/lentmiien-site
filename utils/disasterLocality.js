const { createHash } = require('crypto');
// Public ward centroid is only a fallback. Configured coordinates never leave the server.
const LOCALITY = Object.freeze({ name: '横浜市旭区', earthquakeCode: '1411200', warningCode: '1410011', warningName: '横浜市北部' });
function locationConfig() {
  const number = (value, fallback, max) => Number.isFinite(Number.parseFloat(value)) && Math.abs(Number(value)) <= max ? Number(value) : fallback;
  return { name: process.env.DISASTER_WEATHER_LOCATION_NAME || '横浜旭区',
    latitude: number(process.env.DISASTER_WEATHER_LATITUDE, 35.4759, 90),
    longitude: number(process.env.DISASTER_WEATHER_LONGITUDE, 139.5443, 180) };
}
function locationKey(location = locationConfig()) {
  return createHash('sha256').update(JSON.stringify([location.name, location.latitude, location.longitude])).digest('hex').slice(0, 24);
}
function localWarningCode(code, product, at) {
  if (!['VPWW53', 'VPWW54'].includes(product)) return false;
  if (String(code) === LOCALITY.warningCode) return true;
  // Stop accepting the old city-wide area at the beginning of JMA's transition.
  return String(code) === '1410000' && Number.isFinite(new Date(at).getTime()) && new Date(at) < new Date('2026-05-28T13:00:00+09:00');
}
function distanceKm(a, b) {
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every(Number.isFinite)) return Infinity;
  const rad = x => x * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
module.exports = { LOCALITY, locationConfig, locationKey, localWarningCode, distanceKm };
