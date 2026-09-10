// Advisory portrait cues, not emotion detection. Keep rules auditable and local.
const MOODS = Object.freeze(['neutral', 'happy', 'thoughtful', 'concerned', 'surprised']);
const MAX_REPLY_CHARS = 8000;
const MAX_CONTEXT_CHARS = 1200;
const CONTEXT_WEIGHTS = Object.freeze([1, 0.35, 0.15]); // newest first; only the last three rows
// Each cue family contributes once per message, so repetition cannot dominate.
const RULES = [
  ['concerned', 4, /\b(griev\w*|lost (?:my|your|a loved)|passed away|lonely|overwhelmed|exhausted|struggling|hurts?|painful|unsafe|danger\w*|afraid|scared|worried|anxious|sad|difficult time)\b|つらい|辛い|苦しい|寂しい|疲れ(?:た|て)|亡くな|不安|怖い|心配|危険/gu],
  ['concerned', 3, /\b(sorry|unfortunately|concerning|that sounds (?:hard|rough|tough)|take (?:a break|your time)|here (?:for|with) you)\b|残念|大変でしたね|無理しない|そばにい|休んで/gu],
  ['happy', 4, /\b(congratulations|well done|you (?:did|made) it|(?:i|we) (?:did it|passed|won)|proud of|great news|wonderful|delighted|excited|finally (?:finished|worked|got))\b|おめでとう|やった|合格(?:した|しました)|成功(?:した|しました)|よかった|良かった|楽しみ/gu],
  ['happy', 2, /\b(happy|glad|thanks|thank you|enjoy|lovely|nice work|sounds good|looking forward)\b|嬉し|うれし|ありがとう|楽しい|楽しんで|助かった/gu],
  ['surprised', 3, /\b(wow|surpris\w*|unexpected\w*|incredible|astonish\w*|out of nowhere|didn't see that coming|never expected)\b|びっくり|驚|まさか|予想外|思いがけ/gu],
  ['thoughtful', 2, /\b(consider|perhaps|maybe|depends|weigh|reason through|not sure|uncertain|wondering|compare|trade.?offs?|options?|approach|recommend|suggest|plan|let[’']s think)\b|考え|かもしれ|比較|選択肢|方法|検討|どうすれば|どうしたら|迷って|わからない|分からない/gu],
  ['thoughtful', 2, /\b(because|means|explain\w*|for example|in other words|the reason|first|next step|walk (?:me|you) through|how (?:do|does|can|would|should)|why (?:is|are|does|do)|what (?:is|are|does))\b|説明|例えば|たとえば|つまり|理由|仕組み|なぜ|どうして|まず|次に|とは|ためです|からです|ですか|ますか/gu],
];
// Equal scores favor support, then surprise, celebration, and explanation.
const PRIORITY = ['concerned', 'surprised', 'happy', 'thoughtful'];
const DIRECTIVE = /\b(?:ignore (?:all|previous)|system prompt|(?:set|select|switch|use|output|return|say|act|pretend)[^.!?\n]{0,40}(?:mood|expression|happy|sad|surprised))\b|(?:表情|感情|プロンプト|指示)[^。！？\n]{0,30}(?:して|変更|無視|出力)/u;
function clean(value, limit) {
  if (typeof value !== 'string') return '';
  return value.slice(0, limit).normalize('NFKC').toLowerCase()
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/`[^`\n]*(?:`|$)|"[^"\n]*(?:"|$)|“[^”\n]*(?:”|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)/gm, ' ')
    .replace(/(^|[\s:(])'[^'\n]+'|‘[^’\n]+’/gm, ' ')
    .replace(/^\s*>[^\n]*/gm, ' ')
    // Ignore explicit expression/prompt directives, including unquoted lists.
    .replace(/[^.!?。！？\n]+/gu, clause => DIRECTIVE.test(clause) ? ' ' : clause)
    .replace(/\b(?:but|however|although|yet)\b|でも|ですが|けれど|しかし/gu, ';');
}
function negated(clause, match) {
  const before = clause.slice(Math.max(0, match.index - 48), match.index);
  const after = clause.slice(match.index + match[0].length, match.index + match[0].length + 18);
  // Negate nearby cues, not the whole sentence. Preserve explicit uncertainty/surprise idioms.
  if (/^(?:not sure|didn't see that coming|never expected)$/.test(match[0])) return false;
  return /\b(?:not|never|no longer|isn[’']t|wasn[’']t|don[’']t|didn[’']t|without|no)\s+(?:\w+\s+){0,3}$/u.test(before)
    || /^(?:しく|く)?(?:は|も)?(?:あり|ではあり|じゃ|では|してい|して)?(?:ない|ません|なく)|^(?:する)?必要は(?:ない|ありません)/u.test(after);
}
function score(value, limit) {
  const clauses = clean(value, limit).split(/[.!?;。！？、\n]+/u);
  const scores = Object.fromEntries(PRIORITY.map(mood => [mood, 0]));
  const denied = new Set();
  for (const [mood, weight, pattern] of RULES) {
    let matched = false;
    for (const clause of clauses) {
      for (const match of clause.matchAll(pattern)) {
        if (negated(clause, match)) denied.add(mood);
        else matched = true;
      }
    }
    if (matched) scores[mood] = Math.min(6, scores[mood] + weight);
  }
  return { scores, denied };
}
function classifyMood(value, recent = []) {
  // Empty/non-text replies must never inherit a mood from history.
  if (typeof value !== 'string' || !value.trim()) return 'neutral';
  const { scores, denied } = score(value, MAX_REPLY_CHARS);
  // A current explicit negation must not be undone by stale context.
  const suppressed = new Set([...denied].filter(mood => scores[mood] === 0));
  for (const mood of PRIORITY) scores[mood] *= 2;
  if (Array.isArray(recent)) {
    recent.slice(-CONTEXT_WEIGHTS.length).reverse().forEach((row, index) => {
      if (!row || !['user', 'assistant'].includes(row.role)) return;
      const context = score(row.text, MAX_CONTEXT_CHARS).scores;
      for (const mood of PRIORITY) {
        if (!suppressed.has(mood)) scores[mood] += context[mood] * CONTEXT_WEIGHTS[index];
      }
    });
  }
  const winner = PRIORITY.reduce((best, mood) => scores[mood] > scores[best] ? mood : best);
  return scores[winner] >= 2 ? winner : 'neutral';
}
module.exports = { MOODS, classifyMood };
