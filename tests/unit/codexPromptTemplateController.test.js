jest.mock('../../services/codexToolService', () => ({
  getSessionDetail: jest.fn(),
  listPromptTemplates: jest.fn(),
  listWorkspaces: jest.fn(),
  publicConfig: jest.fn(),
}));
jest.mock('../../services/codexQueueWorker', () => ({
  getStatus: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  warning: jest.fn(),
}));

const codexToolService = require('../../services/codexToolService');
const codexController = require('../../controllers/codexController');

const user = { _id: 'user-1', name: 'Lennart' };

describe('codexController prompt templates', () => {
  test('loads only templates available to the session workspace for follow-ups', async () => {
    const state = {
      session: {
        id: 'session-1',
        title: 'Session',
        workspaceId: 'workspace-2',
      },
    };
    const templates = [
      { id: 'global', name: 'Global', workspaceId: '' },
      { id: 'scoped', name: 'Scoped', workspaceId: 'workspace-2' },
    ];
    codexToolService.getSessionDetail.mockResolvedValue(state);
    codexToolService.listPromptTemplates.mockResolvedValue(templates);
    const req = {
      params: { sessionId: 'session-1' },
      user,
    };
    const res = {
      render: jest.fn(),
    };

    await codexController.renderSession(req, res);

    expect(codexToolService.listPromptTemplates).toHaveBeenCalledWith(user, {
      workspaceId: 'workspace-2',
    });
    expect(res.render).toHaveBeenCalledWith('codex/session', expect.objectContaining({
      codexState: expect.objectContaining({ promptTemplates: templates }),
    }));
  });

  test('loads all existing workspaces for the prompt-library select boxes', async () => {
    const templates = [{ id: 'template-1', name: 'Template', workspaceId: '' }];
    const workspaces = [{ id: 'workspace-1', name: 'Workspace' }];
    codexToolService.listPromptTemplates.mockResolvedValue(templates);
    codexToolService.listWorkspaces.mockResolvedValue(workspaces);
    codexToolService.publicConfig.mockReturnValue({ maxPromptChars: 20000 });
    const req = { user };
    const res = {
      render: jest.fn(),
    };

    await codexController.renderPromptTemplates(req, res);

    expect(codexToolService.listWorkspaces).toHaveBeenCalledWith({ includeDisabled: true });
    expect(res.render).toHaveBeenCalledWith('codex/templates', expect.objectContaining({
      codexState: expect.objectContaining({ templates, workspaces }),
    }));
  });

  test('supports workspace-scoped template API listing', async () => {
    const templates = [{ id: 'global', name: 'Global', workspaceId: '' }];
    codexToolService.listPromptTemplates.mockResolvedValue(templates);
    const req = {
      query: { workspaceId: 'workspace-1' },
      user,
    };
    const res = {
      json: jest.fn(),
    };

    await codexController.listPromptTemplates(req, res);

    expect(codexToolService.listPromptTemplates).toHaveBeenCalledWith(user, {
      workspaceId: 'workspace-1',
    });
    expect(res.json).toHaveBeenCalledWith({ ok: true, templates });
  });
});
