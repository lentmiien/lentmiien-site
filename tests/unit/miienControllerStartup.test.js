jest.mock('../../database', () => ({ RoleModel: { findOne: jest.fn().mockResolvedValue(null) } }));
jest.mock('../../services/messageService', () => jest.fn());
jest.mock('../../services/conversationService', () => jest.fn());
jest.mock('../../services/asrApiService', () => jest.fn());
jest.mock('../../services/chat5ModelCatalogService', () => ({ listAvailableChatModels: jest.fn().mockResolvedValue([]) }));
jest.mock('../../models/miien_speech_slot', () => ({ create: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

const express = require('express');
const path = require('path');
const http = require('axios');
const slots = require('../../models/miien_speech_slot');
const id = 'a'.repeat(24);
const csrfToken = 'A'.repeat(43);
let server;
afterEach(async () => {
  jest.restoreAllMocks();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test.each(['not-an-origin', 'http://gateway.invalid/tts/', 'https://user:secret@gateway.invalid'])('controller startup and text pages work with invalid optional TTS origin %s', async apiBase => {
  const previous = process.env.TTS_API_BASE;
  let router;
  try {
    process.env.TTS_API_BASE = apiBase;
    jest.isolateModules(() => {
      require('mongoose').set('bufferCommands', false);
      const { MiienChatService } = require('../../services/miienChatService');
      jest.spyOn(MiienChatService.prototype, 'list').mockResolvedValue([]);
      jest.spyOn(MiienChatService.prototype, 'owned').mockResolvedValue({ _id: id, title: 'Fixture', metadata: {} });
      jest.spyOn(MiienChatService.prototype, 'compatible').mockResolvedValue();
      jest.spyOn(MiienChatService.prototype, 'speechText').mockResolvedValue('Synthetic saved reply');
      router = require('../../controllers/miienController');
    });
  } finally {
    if (previous === undefined) delete process.env.TTS_API_BASE;
    else process.env.TTS_API_BASE = previous;
  }
  const app = express();
  app.set('views', path.join(__dirname, '../../views')); app.set('view engine', 'pug');
  app.use((req, res, next) => {
    req.user = { _id: 'b'.repeat(24), name: 'owner', type_user: 'admin' };
    req.isAuthenticated = () => true; req.session = { csrfToken }; next();
  });
  app.use('/chat5/miien', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}/chat5/miien`;
  expect((await fetch(base)).status).toBe(200);
  expect((await fetch(`${base}/${id}`)).status).toBe(200);
  expect((await fetch(`${base}/${id}/settings`)).status).toBe(200);
  const response = await fetch(`${base}/${id}/speech`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ messageId: 'c'.repeat(24), voiceId: 'anny_en' }),
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining('Anny is unavailable') });
  expect(http.get).not.toHaveBeenCalled(); expect(http.post).not.toHaveBeenCalled();
  expect(slots.create).not.toHaveBeenCalled();
  // Real ASR model compiled while disconnected, through actual controller wiring.
  const reservation = await fetch(`${base}/${id}/transcribe`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: '{}',
  });
  expect(reservation.status).toBe(503);
  expect(await reservation.json()).toMatchObject({ code: 'asr_database_not_ready', error: expect.stringContaining('could not start') });
});
