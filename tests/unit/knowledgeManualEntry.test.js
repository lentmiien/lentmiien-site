const path = require('path');
const pug = require('pug');

const Chat4KnowledgeModel = require('../../models/chat4_knowledge');

const layoutLocals = {
  loggedIn: true,
  permissions: [],
  bookmarks: [],
  htmlPaths: [],
  gtag: false,
};

describe('manual knowledge entries', () => {
  test('the knowledge model accepts an empty origin chat ID', async () => {
    const now = new Date();
    const entry = new Chat4KnowledgeModel({
      title: 'Standalone note',
      createdDate: now,
      updatedDate: now,
      originConversationId: '',
      originType: 'chat4',
      contentMarkdown: 'A manually entered note.',
      category: 'General',
      tags: [],
      images: [],
      user_id: 'test-user',
    });

    await expect(entry.validate()).resolves.toBeUndefined();
    expect(entry.originConversationId).toBe('');
  });

  test('renders a create form with an intentionally empty chat ID', () => {
    const html = pug.renderFile(path.join(process.cwd(), 'views/edit_knowledge.pug'), {
      ...layoutLocals,
      id: 'new',
      knowledge: {
        title: '',
        originConversationId: '',
        originType: 'chat4',
        contentMarkdown: '',
        category: '',
        tags: [],
        images: [],
      },
      conversations: [],
      messageLookup: [],
      messages: [],
    });

    expect(html).toContain('Create knowledge entry');
    expect(html).toContain('action="/chat4/updateknowledge/new"');
    expect(html).toContain('name="k_originConversationId" value=""');
    expect(html).toContain('This is intentionally left empty for a standalone entry.');
    expect(html).toContain('value="Create entry"');
  });

  test('links to the manual create page from the knowledge list', () => {
    const html = pug.renderFile(path.join(process.cwd(), 'views/knowledge_list.pug'), {
      ...layoutLocals,
      knowledges: [],
      knowledge_categories: [],
      knowledge_tags: [],
    });

    expect(html).toContain('href="/chat4/createknowledge"');
    expect(html).toContain('New knowledge entry');
  });
});
