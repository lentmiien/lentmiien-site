const createModelMock = () => {
  const Model = jest.fn(function (doc = {}) {
    Object.assign(this, doc);
    this.isNew = true;
    this.save = jest.fn().mockResolvedValue(this);
  });

  Model.findOne = jest.fn();
  Model.findById = jest.fn();
  Model.find = jest.fn();
  Model.exists = jest.fn();
  Model.create = jest.fn();
  Model.updateMany = jest.fn();
  Model.deleteMany = jest.fn();
  Model.deleteOne = jest.fn();

  return Model;
};

jest.mock('../../models/learning_topic', () => createModelMock());
jest.mock('../../models/learning_subtopic', () => createModelMock());
jest.mock('../../models/learning_item', () => createModelMock());
jest.mock('../../models/learning_progress', () => createModelMock());
jest.mock('../../models/learning_attempt', () => createModelMock());
jest.mock('../../models/learning_art_asset', () => createModelMock());
jest.mock('../../models/useraccount', () => createModelMock());
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
  info: jest.fn(),
  notice: jest.fn(),
}));

const LearningTopic = require('../../models/learning_topic');
const LearningSubtopic = require('../../models/learning_subtopic');
const LearningItem = require('../../models/learning_item');
const LearningProgress = require('../../models/learning_progress');
const LearningAttempt = require('../../models/learning_attempt');
const LearningArtAsset = require('../../models/learning_art_asset');
const UserAccount = require('../../models/useraccount');
const learningService = require('../../services/learningService');

function createExistingDoc(overrides = {}) {
  return {
    save: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

describe('learningService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    LearningTopic.exists.mockResolvedValue(null);
    LearningSubtopic.exists.mockResolvedValue(null);
    LearningSubtopic.updateMany.mockResolvedValue({ modifiedCount: 1 });
    LearningItem.updateMany.mockResolvedValue({ modifiedCount: 1 });
    LearningProgress.updateMany.mockResolvedValue({ modifiedCount: 1 });
    LearningAttempt.updateMany.mockResolvedValue({ modifiedCount: 1 });
    LearningAttempt.create.mockResolvedValue({});
    LearningArtAsset.exists.mockResolvedValue(null);
    LearningArtAsset.find.mockResolvedValue([]);
    UserAccount.find.mockResolvedValue([]);
    UserAccount.findById.mockResolvedValue(null);
  });

  test('saveTopicFromForm cascades slug updates to linked records', async () => {
    const topic = createExistingDoc({
      _id: 'topic-1',
      stableId: 'topic_chemistry',
      slug: 'chemistry',
      title: 'Chemistry',
    });
    LearningTopic.findById.mockResolvedValue(topic);

    const result = await learningService.saveTopicFromForm({
      topicId: 'topic-1',
      title: 'Chemistry Fun',
      slug: 'chemistry-fun',
      status: 'published',
    }, 'Admin');

    expect(topic.save).toHaveBeenCalledTimes(1);
    expect(LearningSubtopic.updateMany).toHaveBeenCalledWith(
      { topicId: 'topic-1' },
      {
        $set: {
          topicStableId: 'topic_chemistry',
          topicSlug: 'chemistry-fun',
        },
      }
    );
    expect(LearningItem.updateMany).toHaveBeenCalledWith(
      { topicId: 'topic-1' },
      {
        $set: {
          topicStableId: 'topic_chemistry',
          topicSlug: 'chemistry-fun',
        },
      }
    );
    expect(LearningProgress.updateMany).toHaveBeenCalledWith(
      { topicId: 'topic-1' },
      {
        $set: {
          topicStableId: 'topic_chemistry',
          topicSlug: 'chemistry-fun',
        },
      }
    );
    expect(LearningAttempt.updateMany).toHaveBeenCalledWith(
      { topicId: 'topic-1' },
      {
        $set: {
          topicStableId: 'topic_chemistry',
        },
      }
    );
    expect(result.slug).toBe('chemistry-fun');
  });

  test('saveSubtopicFromForm cascades topic and slug changes to linked records', async () => {
    const existingSubtopic = createExistingDoc({
      _id: 'sub-1',
      stableId: 'subtopic_atoms',
      topicId: 'topic-1',
      topicStableId: 'topic_chemistry',
      topicSlug: 'chemistry',
      slug: 'atoms',
      title: 'Atoms',
    });
    const nextTopic = {
      _id: 'topic-2',
      stableId: 'topic_space',
      slug: 'space',
      title: 'Space',
    };
    LearningSubtopic.findById.mockResolvedValue(existingSubtopic);
    LearningTopic.findById.mockResolvedValue(nextTopic);

    const result = await learningService.saveSubtopicFromForm({
      subtopicId: 'sub-1',
      topicId: 'topic-2',
      title: 'Planets',
      slug: 'planets',
      status: 'published',
    }, 'Admin');

    expect(existingSubtopic.save).toHaveBeenCalledTimes(1);
    expect(LearningItem.updateMany).toHaveBeenCalledWith(
      { subtopicId: 'sub-1' },
      {
        $set: {
          topicId: 'topic-2',
          topicStableId: 'topic_space',
          topicSlug: 'space',
          subtopicStableId: 'subtopic_atoms',
          subtopicSlug: 'planets',
        },
      }
    );
    expect(LearningProgress.updateMany).toHaveBeenCalledWith(
      { subtopicId: 'sub-1' },
      {
        $set: {
          topicId: 'topic-2',
          topicStableId: 'topic_space',
          topicSlug: 'space',
          subtopicStableId: 'subtopic_atoms',
          subtopicSlug: 'planets',
        },
      }
    );
    expect(LearningAttempt.updateMany).toHaveBeenCalledWith(
      { subtopicId: 'sub-1' },
      {
        $set: {
          topicId: 'topic-2',
          topicStableId: 'topic_space',
          subtopicStableId: 'subtopic_atoms',
        },
      }
    );
    expect(result.slug).toBe('planets');
  });

  test('getSubtopicPlayerData preview does not save progress', async () => {
    const user = { _id: 'user-1', name: 'Kid' };
    const topic = {
      _id: 'topic-1',
      stableId: 'topic_chemistry',
      slug: 'chemistry',
      title: 'Chemistry',
      shortLabel: 'Chem',
      description: 'Fun science',
      theme: {},
    };
    const subtopic = {
      _id: 'sub-1',
      stableId: 'subtopic_atoms',
      slug: 'atoms',
      title: 'Atoms',
      description: 'Tiny building blocks',
      estimatedMinutes: 3,
      reward: {
        label: 'Atom sticker',
        stickerArt: { kind: 'emoji', value: '⚛️' },
      },
      theme: {},
    };
    const items = [
      {
        _id: 'item-1',
        stableId: 'item-1',
        title: 'Pick the atom',
        prompt: 'Which one is an atom?',
        helperText: '',
        blurb: '',
        kind: 'question',
        templateType: 'single_choice',
        order: 1,
        points: 2,
        config: {
          options: [
            { key: 'atom', label: 'Atom', art: { kind: 'emoji', value: '⚛️' } },
            { key: 'rock', label: 'Rock', art: { kind: 'emoji', value: '🪨' } },
          ],
        },
      },
    ];
    const progress = createExistingDoc({
      userId: 'user-1',
      subtopicId: 'sub-1',
      itemStates: [],
      isNew: false,
    });

    LearningTopic.findOne.mockResolvedValue(topic);
    LearningSubtopic.findOne.mockResolvedValue(subtopic);
    LearningItem.find.mockResolvedValue(items);
    LearningProgress.findOne.mockResolvedValue(progress);

    const result = await learningService.getSubtopicPlayerData(user, 'chemistry', 'atoms', { preview: true });

    expect(progress.save).not.toHaveBeenCalled();
    expect(result.preview).toBe(true);
    expect(result.progress.totalItems).toBe(1);
    expect(result.progress.maxStars).toBe(2);
  });

  test('submitItemResponse preview evaluates answers without saving progress or attempts', async () => {
    const user = { _id: 'user-1', name: 'Kid' };
    const topic = {
      _id: 'topic-1',
      stableId: 'topic_chemistry',
      slug: 'chemistry',
      title: 'Chemistry',
      description: 'Fun science',
      theme: {},
    };
    const subtopic = {
      _id: 'sub-1',
      stableId: 'subtopic_atoms',
      slug: 'atoms',
      title: 'Atoms',
      description: 'Tiny building blocks',
      reward: {
        label: 'Atom sticker',
        stickerArt: { kind: 'emoji', value: '⚛️' },
      },
      theme: {},
    };
    const item = {
      _id: 'item-1',
      stableId: 'item-1',
      title: 'Pick the atom',
      prompt: 'Which one is an atom?',
      helperText: '',
      blurb: '',
      kind: 'question',
      templateType: 'single_choice',
      order: 1,
      points: 2,
      config: {
        options: [
          { key: 'atom', label: 'Atom', art: { kind: 'emoji', value: '⚛️' } },
          { key: 'rock', label: 'Rock', art: { kind: 'emoji', value: '🪨' } },
        ],
        correctOptionKey: 'atom',
        goodFeedback: 'Great job!',
        badFeedback: 'Try again!',
      },
    };
    const progress = createExistingDoc({
      userId: 'user-1',
      subtopicId: 'sub-1',
      itemStates: [
        {
          itemId: 'item-1',
          itemStableId: 'item-1',
          templateType: 'single_choice',
          status: 'not_started',
          attempts: 0,
          correctAttempts: 0,
          completed: false,
          starsEarned: 0,
          firstCompletedAt: null,
          lastCompletedAt: null,
          lastAttemptAt: null,
          lastResult: 'none',
          lastAnswer: null,
        },
      ],
      isNew: false,
    });

    LearningSubtopic.findOne.mockResolvedValue(subtopic);
    LearningTopic.findById.mockResolvedValue(topic);
    LearningItem.findOne.mockResolvedValue(item);
    LearningItem.find.mockResolvedValue([item]);
    LearningProgress.findOne.mockResolvedValue(progress);

    const result = await learningService.submitItemResponse({
      user,
      subtopicStableId: 'subtopic_atoms',
      itemStableId: 'item-1',
      payload: { optionKey: 'atom' },
      preview: true,
    });

    expect(result.isCorrect).toBe(true);
    expect(result.starsAwarded).toBe(2);
    expect(result.progress.completedItems).toBe(1);
    expect(progress.save).not.toHaveBeenCalled();
    expect(LearningAttempt.create).not.toHaveBeenCalled();
  });

  test('saveArtAssetFromUpload stores sanitized SVG library entries', async () => {
    const result = await learningService.saveArtAssetFromUpload({
      body: {
        title: 'Water Drop',
        key: 'water-drop',
        description: 'Reusable droplet art',
      },
      file: {
        originalname: 'water-drop.svg',
        buffer: Buffer.from('<svg viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4" /></svg>'),
      },
      userName: 'Admin',
    });

    expect(result.key).toBe('water-drop');
    expect(result.title).toBe('Water Drop');
    expect(result.svgMarkup).toContain('<svg');
    expect(result.svgMarkup).not.toContain('<script');
    expect(result.save).toHaveBeenCalledTimes(1);
  });
});
