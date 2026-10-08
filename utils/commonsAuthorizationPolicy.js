const PLAY = 'commons.world.play';
const TALK = 'commons.npc.talk';
const OPERATIONS = 'commons.operations.read';
const ROLE_BUNDLES = Object.freeze({ admin: [PLAY, TALK, OPERATIONS], family: [], user: [] });
module.exports = { PLAY, TALK, OPERATIONS, ROLE_BUNDLES };
