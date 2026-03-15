const learningService = require('../services/learningService');
const logger = require('../utils/logger');

let seedPromise = null;

function createSeedPromise() {
  return learningService.ensureSeedData().catch((error) => {
    seedPromise = null;
    throw error;
  });
}

async function ensureSeedData() {
  if (!seedPromise) {
    seedPromise = createSeedPromise();
  }
  return seedPromise;
}

function isPreviewMode(req) {
  return req.user?.type_user === 'admin' && String(req.query.preview || '') === '1';
}

function stringifyForScript(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function renderPageError(res, error, fallbackMessage) {
  const status = error?.statusCode || 500;
  const message = error?.message || fallbackMessage;
  res.status(status).render('error_page', { error: message });
}

exports.home = async (req, res) => {
  try {
    await ensureSeedData();
    const preview = isPreviewMode(req);
    const pageData = await learningService.getHomePageData(req.user, { preview });

    return res.render('learning_home', {
      ...pageData,
      previewMode: preview,
    });
  } catch (error) {
    logger.error('Unable to render learning home', {
      category: 'learning',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });
    return renderPageError(res, error, 'Unable to open the learning home page.');
  }
};

exports.topic = async (req, res) => {
  try {
    await ensureSeedData();
    const preview = isPreviewMode(req);
    const topic = await learningService.getTopicPageData(req.user, req.params.topicSlug, { preview });

    if (!topic) {
      return res.status(404).render('error_page', { error: 'Learning topic not found.' });
    }

    return res.render('learning_topic', {
      topic,
      previewMode: preview,
    });
  } catch (error) {
    logger.error('Unable to render learning topic', {
      category: 'learning',
      metadata: {
        userId: String(req.user?._id || ''),
        topicSlug: req.params.topicSlug,
        error: error.message,
      },
    });
    return renderPageError(res, error, 'Unable to open this learning topic.');
  }
};

exports.subtopic = async (req, res) => {
  try {
    await ensureSeedData();
    const preview = isPreviewMode(req);
    const playerData = await learningService.getSubtopicPlayerData(
      req.user,
      req.params.topicSlug,
      req.params.subtopicSlug,
      { preview }
    );

    if (!playerData) {
      return res.status(404).render('error_page', { error: 'Learning subtopic not found.' });
    }

    return res.render('learning_subtopic', {
      themeStyle: playerData.themeStyle,
      learningBootstrapJson: stringifyForScript(playerData),
      previewMode: preview,
    });
  } catch (error) {
    logger.error('Unable to render learning subtopic', {
      category: 'learning',
      metadata: {
        userId: String(req.user?._id || ''),
        topicSlug: req.params.topicSlug,
        subtopicSlug: req.params.subtopicSlug,
        error: error.message,
      },
    });
    return renderPageError(res, error, 'Unable to open this learning lesson.');
  }
};

exports.submit_item = async (req, res) => {
  try {
    await ensureSeedData();
    const result = await learningService.submitItemResponse({
      user: req.user,
      subtopicStableId: req.params.subtopicStableId,
      itemStableId: req.params.itemStableId,
      payload: req.body,
      preview: isPreviewMode(req),
    });
    return res.json(result);
  } catch (error) {
    const status = error?.statusCode || 500;
    logger.warning('Unable to submit learning answer', {
      category: 'learning',
      metadata: {
        userId: String(req.user?._id || ''),
        subtopicStableId: req.params.subtopicStableId,
        itemStableId: req.params.itemStableId,
        error: error.message,
      },
    });
    return res.status(status).json({ error: error.message || 'Unable to save answer.' });
  }
};

exports.reset_progress = async (req, res) => {
  try {
    await ensureSeedData();
    const result = await learningService.resetSubtopicProgress({
      user: req.user,
      subtopicStableId: req.params.subtopicStableId,
      preview: isPreviewMode(req),
    });
    return res.json(result);
  } catch (error) {
    const status = error?.statusCode || 500;
    logger.warning('Unable to reset learning progress', {
      category: 'learning',
      metadata: {
        userId: String(req.user?._id || ''),
        subtopicStableId: req.params.subtopicStableId,
        error: error.message,
      },
    });
    return res.status(status).json({ error: error.message || 'Unable to reset progress.' });
  }
};
