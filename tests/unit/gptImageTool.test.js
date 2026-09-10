jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../models/useraccount', () => ({ findById: jest.fn() }));
jest.mock('../../models/role', () => ({ findOne: jest.fn() }));
jest.mock('../../services/gptImageService', () => ({ ...jest.requireActual('../../services/gptImageService'), createImageGeneration: jest.fn() }));
const User = require('../../models/useraccount');
const service = require('../../services/gptImageService');
const handlers = require('../../services/toolHandlerRegistry');
const principal = { _id: 'a'.repeat(24), name: 'user', type_user: 'user' };
beforeEach(() => {
  User.findById.mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => principal }) }) });
  service.createImageGeneration.mockImplementation(async ({ rawOptions }) => ({ images: [{ id: 'image', model: rawOptions.model, modelLabel: 'label', outputUrl: '/gpt-image/media/image.png' }] }));
});
test.each([['generate', 'gpt-image-2'], ['generateSunburst', 'gpt-image-2.5-sunburst'], ['generateFlare', 'gpt-image-2.5-flare']])('%s is pinned to %s independent of custom tool metadata', async (handler, model) => {
  const result = await handlers[`gptImage.${handler}`].execute({ prompt: 'Test' }, { user: principal, createdBy: 'spoof', openaiUser: 'spoof', tool: { metadata: { model: 'wrong' } } });
  expect(service.createImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ rawOptions: expect.objectContaining({ model }), user: principal, createdBy: 'Tool', openaiUser: principal._id }));
  expect(result).toMatchObject({ model, images: [expect.objectContaining({ model })] });
  await expect(handlers[`gptImage.${handler}`].execute({ prompt: 'Test', model: 'override' }, { user: principal })).rejects.toThrow('Unsupported');
});
test('tools reject missing, spoofed and deleted principals before touching image service', async () => {
  for (const context of [{}, { userName: 'admin', userId: principal._id }, { user: { _id: principal._id } }]) {
    await expect(handlers['gptImage.generateSunburst'].execute({ prompt: 'Test' }, context)).rejects.toMatchObject({ statusCode: 403 });
  }
  User.findById.mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => null }) }) });
  await expect(handlers['gptImage.generateFlare'].execute({ prompt: 'Test' }, { user: principal })).rejects.toMatchObject({ statusCode: 403 });
  expect(service.createImageGeneration).not.toHaveBeenCalled();
});
