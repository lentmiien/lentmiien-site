const { INTENSITIES } = require('./disasterLocalEvidence');
const WEATHER = ['clear-day', 'clear-night', 'cloudy', 'rain', 'snow', 'storm', 'fog', 'unknown', 'stale'];
const TYPHOON = ['unknown', 'proximity', 'probability', 'advisory', 'warning', 'emergency'];
const shaking = ['No felt shaking reported', 'Slight shaking may be felt', 'Shaking felt indoors; hanging objects stir', 'Noticeable indoor shaking', 'Hanging objects swing; unsecured objects may fall', 'Objects may fall; hold on to something', 'Furniture may move; walking is difficult', 'Standing is difficult; unsecured furniture may topple', 'Movement requires crawling; furniture may fall', 'Severe shaking; furniture may be thrown'];
function artwork(group, key) {
  const allowed = group === 'weather' ? WEATHER : group === 'earthquake' ? ['unknown', ...INTENSITIES] : TYPHOON;
  const selected = allowed.includes(key) ? key : 'unknown';
  return `/i/disaster/v3/${group}-${group === 'earthquake' ? selected.replace('-', 'minus').replace('+', 'plus') : selected}.svg`;
}
function weatherCondition(source, code, isDay) {
  const n = Number(code);
  if (code == null || code === '' || !Number.isFinite(n)) return 'unknown';
  if (source?.startsWith('openweathermap')) {
    if (n === 800) return isDay === false ? 'clear-night' : isDay === true ? 'clear-day' : 'unknown';
    if (n >= 801 && n <= 804) return 'cloudy';
    if (n >= 200 && n < 300) return 'storm';
    if (n >= 300 && n < 600) return 'rain';
    if (n >= 600 && n < 700) return 'snow';
    if (n >= 700 && n < 800) return 'fog';
  } else if (source?.startsWith('open-meteo')) {
    if (n === 0) return isDay === false ? 'clear-night' : isDay === true ? 'clear-day' : 'unknown';
    if ([1, 2, 3].includes(n)) return 'cloudy';
    if ([45, 48].includes(n)) return 'fog';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(n)) return 'rain';
    if ([71, 73, 75, 77, 85, 86].includes(n)) return 'snow';
    if ([95, 96, 99].includes(n)) return 'storm';
  }
  return 'unknown';
}
module.exports = { WEATHER, TYPHOON, shaking, artwork, weatherCondition };
