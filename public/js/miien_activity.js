((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiienActivity = factory();
})(typeof window === 'object' ? window : this, () => {
  'use strict';
  function stateOf(signals) {
    if (signals.permission) return { state: 'idle', status: 'Requesting microphone…' };
    if (signals.recording) return { state: 'listening', status: 'Listening · recording microphone' };
    if (signals.asr) return { state: 'thinking', status: 'Transcribing microphone…' };
    if (signals.chat) return { state: 'thinking', status: 'Waiting for Chat5 reply…' };
    if (signals.voice === 'playing') return { state: 'speaking', status: 'Speaking · audio playing' };
    if (signals.voice === 'buffering') return { state: 'thinking', status: 'Buffering voice…' };
    if (signals.voice === 'preparing') return { state: 'thinking', status: 'Preparing voice · you can keep typing' };
    if (signals.review) return { state: 'idle', status: 'Review your transcript · edit, then Send' };
    return { state: 'idle', status: 'Ready to talk' };
  }
  function create(onChange) {
    const signals = { permission: false, recording: false, asr: false, chat: false, review: false, voice: 'idle' };
    return {
      update(patch) {
        for (const key of ['permission', 'recording', 'asr', 'chat', 'review']) if (typeof patch[key] === 'boolean') signals[key] = patch[key];
        if (['idle', 'preparing', 'buffering', 'playing'].includes(patch.voice)) signals.voice = patch.voice;
        const state = stateOf(signals);
        onChange(state);
        return state;
      },
    };
  }
  return { stateOf, create };
});
