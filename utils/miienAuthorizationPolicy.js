const READ = 'chat.conversation.read';
const WRITE = 'chat.conversation.write';
const TRANSCRIBE = 'chat.audio.transcribe';
const MIIEN_ROLE_CAPABILITY_BUNDLES = Object.freeze({
  admin: [READ, WRITE, TRANSCRIBE], family: [], user: [],
});
module.exports = { READ, WRITE, TRANSCRIBE, MIIEN_ROLE_CAPABILITY_BUNDLES };
