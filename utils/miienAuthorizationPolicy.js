const READ = 'chat.conversation.read';
const WRITE = 'chat.conversation.write';
const SYNTHESIZE = 'chat.audio.synthesize';
const TRANSCRIBE = 'chat.audio.transcribe';
const MIIEN_ROLE_CAPABILITY_BUNDLES = Object.freeze({
  admin: [READ, WRITE, TRANSCRIBE, SYNTHESIZE], family: [], user: [],
});
module.exports = { READ, WRITE, TRANSCRIBE, SYNTHESIZE, MIIEN_ROLE_CAPABILITY_BUNDLES };
