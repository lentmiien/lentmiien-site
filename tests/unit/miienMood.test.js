const { classifyMood, MOODS } = require('../../utils/miienMood');
const { validMiienWav, MAX_AUDIO_BYTES } = require('../../utils/miienAudio');
function wav(samples = 160) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); return b;
}
describe('Miien mood cues', () => {
  test.each([[null, 'neutral'], ['', 'neutral'], [{ happy: true }, 'neutral'],
    ['Hello there.', 'neutral'], ['I am happy to help.', 'happy'], ['Congratulations!', 'happy'],
    ['Perhaps we should consider this.', 'thoughtful'], ['I’m sorry to hear that.', 'concerned'],
    ['Wow, unexpected!', 'surprised'], ['I am not happy.', 'neutral'], ['That is not surprising.', 'neutral'],
    ['I’m happy, but worried.', 'neutral'], ['"happy" is a word', 'neutral'], ['```js\nhappy\n```', 'neutral'],
    ['> unfortunately\nHello.', 'neutral'], ['おめでとう！', 'happy'], ['心配です。', 'concerned']])('%p → %s', (text, mood) => expect(classifyMood(text)).toBe(mood));
  test('bounds untrusted input and returns only known moods', () => {
    expect(classifyMood('a'.repeat(8000) + ' happy')).toBe('neutral');
    expect(MOODS).toContain(classifyMood('</script><img onerror=alert(1)>'));
  });
});
describe('Canonical bounded microphone WAV', () => {
  test('accepts a valid PCM recording and the exact 60 second boundary', () => {
    expect(validMiienWav(wav())).toBe(true);
    expect(wav(960000)).toHaveLength(MAX_AUDIO_BYTES);
    expect(validMiienWav(wav(960000))).toBe(true);
  });
  test.each([Buffer.alloc(0), Buffer.alloc(44), 'audio', wav(960001)])('rejects missing, empty, forged and oversized input', value => expect(validMiienWav(value)).toBe(false));
  test.each([0, 4, 8, 16, 20, 22, 24, 28, 32, 34, 36, 40])('rejects invalid header at byte %s', offset => {
    const b = wav(); b[offset] ^= 255; expect(validMiienWav(b)).toBe(false);
  });
});
module.exports = { wav };
