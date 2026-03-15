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

function buildAdminPath(params = {}) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });

  const query = search.toString();
  return `/admin/learning${query ? `?${query}` : ''}`;
}

function dashboardSelectionFromQuery(query) {
  return {
    selectedTopicId: typeof query.topicId === 'string' ? query.topicId : '',
    selectedSubtopicId: typeof query.subtopicId === 'string' ? query.subtopicId : '',
    selectedItemId: typeof query.itemId === 'string' ? query.itemId : '',
  };
}

exports.dashboard = async (req, res) => {
  try {
    await ensureSeedData();
    const selection = dashboardSelectionFromQuery(req.query);
    const dashboardData = await learningService.getAdminDashboardData(selection);

    return res.render('admin_learning', {
      ...dashboardData,
      successMessage: typeof req.query.success === 'string' ? req.query.success : null,
      errorMessage: typeof req.query.error === 'string' ? req.query.error : null,
    });
  } catch (error) {
    logger.error('Unable to render learning admin dashboard', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });

    return res.status(error?.statusCode || 500).render('error_page', {
      error: error.message || 'Unable to open the learning admin dashboard.',
    });
  }
};

exports.save_topic = async (req, res) => {
  try {
    const topic = await learningService.saveTopicFromForm(req.body, req.user.name);
    return res.redirect(buildAdminPath({
      topicId: String(topic._id),
      success: 'Topic saved.',
    }));
  } catch (error) {
    logger.warning('Unable to save learning topic', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });

    return res.redirect(buildAdminPath({
      topicId: req.body.topicId,
      error: error.message || 'Unable to save topic.',
    }));
  }
};

exports.save_subtopic = async (req, res) => {
  try {
    const subtopic = await learningService.saveSubtopicFromForm(req.body, req.user.name);
    return res.redirect(buildAdminPath({
      topicId: String(subtopic.topicId),
      subtopicId: String(subtopic._id),
      success: 'Subtopic saved.',
    }));
  } catch (error) {
    logger.warning('Unable to save learning subtopic', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });

    return res.redirect(buildAdminPath({
      topicId: req.body.topicId,
      subtopicId: req.body.subtopicId,
      error: error.message || 'Unable to save subtopic.',
    }));
  }
};

exports.save_item = async (req, res) => {
  try {
    const item = await learningService.saveItemFromForm(req.body, req.user.name);
    return res.redirect(buildAdminPath({
      subtopicId: String(item.subtopicId),
      itemId: String(item._id),
      success: 'Item saved.',
    }));
  } catch (error) {
    logger.warning('Unable to save learning item', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });

    return res.redirect(buildAdminPath({
      subtopicId: req.body.subtopicId,
      itemId: req.body.itemId,
      error: error.message || 'Unable to save item.',
    }));
  }
};

exports.delete_topic = async (req, res) => {
  try {
    await learningService.deleteTopicById(req.body.topicId);
    return res.redirect(buildAdminPath({ success: 'Topic deleted.' }));
  } catch (error) {
    logger.warning('Unable to delete learning topic', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        topicId: req.body.topicId,
        error: error.message,
      },
    });

    return res.redirect(buildAdminPath({
      topicId: req.body.topicId,
      error: error.message || 'Unable to delete topic.',
    }));
  }
};

exports.delete_subtopic = async (req, res) => {
  try {
    await learningService.deleteSubtopicById(req.body.subtopicId);
    return res.redirect(buildAdminPath({
      topicId: req.body.topicId,
      success: 'Subtopic deleted.',
    }));
  } catch (error) {
    logger.warning('Unable to delete learning subtopic', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        subtopicId: req.body.subtopicId,
        error: error.message,
      },
    });

    return res.redirect(buildAdminPath({
      topicId: req.body.topicId,
      subtopicId: req.body.subtopicId,
      error: error.message || 'Unable to delete subtopic.',
    }));
  }
};

exports.delete_item = async (req, res) => {
  try {
    await learningService.deleteItemById(req.body.itemId);
    return res.redirect(buildAdminPath({
      subtopicId: req.body.subtopicId,
      success: 'Item deleted.',
    }));
  } catch (error) {
    logger.warning('Unable to delete learning item', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        itemId: req.body.itemId,
        error: error.message,
      },
    });

    return res.redirect(buildAdminPath({
      subtopicId: req.body.subtopicId,
      itemId: req.body.itemId,
      error: error.message || 'Unable to delete item.',
    }));
  }
};
