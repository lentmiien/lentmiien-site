const PLAY = 'commons.world.play';
const TALK = 'commons.npc.talk';
const OPERATIONS = 'commons.operations.read';
const SHELTER = 'commons.shelter.read';
const DIARY_READ = 'commons.diary.read';
const DIARY_WRITE = 'commons.diary.write';
const ROLE_BUNDLES = Object.freeze({ admin: [PLAY, TALK, OPERATIONS, SHELTER, DIARY_READ, DIARY_WRITE], family: [SHELTER, DIARY_READ, DIARY_WRITE], user: [DIARY_READ, DIARY_WRITE] });
module.exports = { PLAY, TALK, OPERATIONS, SHELTER, DIARY_READ, DIARY_WRITE, ROLE_BUNDLES };
