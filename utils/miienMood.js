const MOODS = Object.freeze(['neutral', 'happy', 'thoughtful', 'concerned', 'surprised']);
const RULES = [
  ['concerned', /\b(sorry|unfortunately|worried|concerning|danger|unsafe|sad|difficult time)\b|残念|心配|危険/u],
  ['happy', /\b(happy|glad|wonderful|congratulations|great news|delighted|excited)\b|嬉しい|うれしい|おめでとう/u],
  ['surprised', /\b(wow|surprising|surprised|unexpected|incredible)\b|びっくり|驚/u],
  ['thoughtful', /\b(consider|perhaps|let’s think|let's think|depends|weigh|reason through)\b|考え|かもしれ/u],
];

function classifyMood(value) {
  if (typeof value !== 'string' || !value.trim()) return 'neutral';
  // Bounded literal matching only. Ignore quoted/code material and simple negated clauses.
  const text = value.slice(0, 8000).toLowerCase()
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`]*`|"[^"\n]*"|^>[^\n]*/gm, ' ')
    .replace(/\b(?:not|never|no longer|isn't|isn’t|don't|don’t)\b[^.!?;,\n]{0,70}/gu, ' ');
  const matches = RULES.filter(([, rule]) => rule.test(text)).map(([mood]) => mood);
  // Mixed emotion is ambiguous; do not pretend this is sentiment understanding.
  return matches.length === 1 ? matches[0] : 'neutral';
}
module.exports = { MOODS, classifyMood };
