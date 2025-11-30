const HTML_RATING_CATEGORIES = [
  { key: 'looksGood', label: 'Looks good' },
  { key: 'isFun', label: 'Is fun' },
  { key: 'hasGoodUi', label: 'Has good UI' },
  { key: 'educational', label: 'Educational' },
];

function parseRatingValue(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 5) {
    return null;
  }

  return rounded;
}

function computeAverageRating(ratings = {}) {
  const validScores = HTML_RATING_CATEGORIES
    .map(({ key }) => ratings[key])
    .filter((value) => Number.isFinite(value));

  if (!validScores.length) {
    return null;
  }

  const average = validScores.reduce((sum, value) => sum + value, 0) / validScores.length;
  return Math.round(average * 100) / 100;
}

module.exports = {
  HTML_RATING_CATEGORIES,
  parseRatingValue,
  computeAverageRating,
};
