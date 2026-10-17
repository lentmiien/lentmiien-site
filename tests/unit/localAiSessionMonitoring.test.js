jest.mock('../../utils/logger', () => ({ warning: jest.fn(), notice: jest.fn() }));
jest.mock('../../middleware/databaseReadiness', () => ({ isDatabaseReady: jest.fn(() => true) }));
jest.mock('../../models/local_ai', () => ({ Session: { findOne: jest.fn() } }));
const { createMonitoringService } = require('../../services/aiGatewayMonitoringService');
const { Session } = require('../../models/local_ai');
const { isDatabaseReady } = require('../../middleware/databaseReadiness');
test('held idle GPU stays reserved; loss of ownership visibility becomes unknown; CPU remains available', async () => {
  const raw = { health: { ok: true, status: 'ok', failures: [], upstreams: { ollama: { ok: true }, voicevox: { ok: true } } },
    containers: { containers: [
      { id: 'ollama', state: 'running', running: true, default_state: 'running', gpu_role: 'heavy' },
      { id: 'voicevox', state: 'running', running: true, default_state: 'running', gpu_role: 'none' },
    ] }, queue: { running: true, active: null }, reservation: { active: false } };
  const service = createMonitoringService({ baseUrl: 'http://synthetic.invalid' });
  service.observe(raw);
  Session.findOne.mockReturnValue({ select: () => ({ lean: async () => ({ state: 'held', remote: { token: 'SECRET' } }) }) });
  const held = await service.get();
  expect(held.services.find(s => s.id === 'ollama').availability).toContain('reserved');
  expect(held.services.find(s => s.id === 'voicevox').availability).toBe('Responsive');
  expect(JSON.stringify(held)).not.toContain('SECRET');
  isDatabaseReady.mockReturnValue(false);
  expect((await service.get()).services.find(s => s.id === 'ollama').availability).toBe('Session ownership unknown');
});
