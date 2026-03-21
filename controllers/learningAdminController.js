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

function appendQueryParams(path, params = {}) {
  const url = new URL(path, 'http://localhost');

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, value);
  });

  return `${url.pathname}${url.search}`;
}

function parseFlag(value) {
  return value === true || value === '1' || value === 'true' || value === 1;
}

function sanitizeReturnToPath(rawPath) {
  const value = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!value.startsWith('/admin/learning')) {
    return '/admin/learning';
  }
  return value;
}

function dashboardSelectionFromQuery(query) {
  return {
    selectedTopicId: typeof query.topicId === 'string' ? query.topicId : '',
    selectedSubtopicId: typeof query.subtopicId === 'string' ? query.subtopicId : '',
    selectedItemId: typeof query.itemId === 'string' ? query.itemId : '',
    selectedTemplateProfileId: typeof query.templateProfileId === 'string' ? query.templateProfileId : '',
    creatingTopic: parseFlag(query.newTopic),
    creatingSubtopic: parseFlag(query.newSubtopic),
    creatingItem: parseFlag(query.newItem),
    creatingTemplate: parseFlag(query.newTemplate),
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
      newTopic: !req.body.topicId ? '1' : '',
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
      newSubtopic: !req.body.subtopicId ? '1' : '',
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
      topicId: req.body.topicId,
      subtopicId: req.body.subtopicId,
      itemId: req.body.itemId,
      newItem: !req.body.itemId ? '1' : '',
      error: error.message || 'Unable to save item.',
    }));
  }
};

exports.save_template_profile = async (req, res) => {
  try {
    const profile = await learningService.saveTemplateProfileFromForm(req.body, req.user.name);
    return res.redirect(buildAdminPath({
      topicId: req.body.topicContextId,
      subtopicId: req.body.subtopicContextId,
      itemId: req.body.itemContextId,
      templateProfileId: String(profile._id),
      success: 'Template profile saved.',
    }));
  } catch (error) {
    logger.warning('Unable to save learning template profile', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });

    return res.redirect(buildAdminPath({
      topicId: req.body.topicContextId,
      subtopicId: req.body.subtopicContextId,
      itemId: req.body.itemContextId,
      templateProfileId: req.body.templateProfileId,
      newTemplate: !req.body.templateProfileId ? '1' : '',
      error: error.message || 'Unable to save template profile.',
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

exports.delete_template_profile = async (req, res) => {
  try {
    await learningService.deleteTemplateProfileById(req.body.templateProfileId);
    return res.redirect(buildAdminPath({
      topicId: req.body.topicContextId,
      subtopicId: req.body.subtopicContextId,
      itemId: req.body.itemContextId,
      success: 'Template profile deleted.',
    }));
  } catch (error) {
    logger.warning('Unable to delete learning template profile', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        templateProfileId: req.body.templateProfileId,
        error: error.message,
      },
    });

    return res.redirect(buildAdminPath({
      topicId: req.body.topicContextId,
      subtopicId: req.body.subtopicContextId,
      itemId: req.body.itemContextId,
      templateProfileId: req.body.templateProfileId,
      error: error.message || 'Unable to delete template profile.',
    }));
  }
};

exports.art_library = async (req, res) => {
  try {
    await ensureSeedData();
    const artData = await learningService.getAdminArtLibraryData();

    return res.render('admin_learning_art', {
      ...artData,
      successMessage: typeof req.query.success === 'string' ? req.query.success : null,
      errorMessage: typeof req.query.error === 'string' ? req.query.error : null,
    });
  } catch (error) {
    logger.error('Unable to render learning art library', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });

    return res.status(error?.statusCode || 500).render('error_page', {
      error: error.message || 'Unable to open the learning art library.',
    });
  }
};

exports.upload_art_asset = async (req, res) => {
  const returnTo = sanitizeReturnToPath(req.body.returnTo);

  try {
    if (req.learningArtUploadError) {
      throw new Error(req.learningArtUploadError);
    }

    const asset = await learningService.saveArtAssetFromUpload({
      body: req.body,
      file: req.file,
      userName: req.user.name,
    });

    return res.redirect(appendQueryParams(returnTo, {
      success: `SVG art saved as ${asset.key}.`,
    }));
  } catch (error) {
    logger.warning('Unable to save learning art asset', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });

    return res.redirect(appendQueryParams(returnTo, {
      error: error.message || 'Unable to save SVG art.',
    }));
  }
};

exports.users = async (req, res) => {
  try {
    await ensureSeedData();
    const pageData = await learningService.getAdminUsersProgressData();

    return res.render('admin_learning_users', pageData);
  } catch (error) {
    logger.error('Unable to render learning user overview', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });

    return res.status(error?.statusCode || 500).render('error_page', {
      error: error.message || 'Unable to open the learning user overview.',
    });
  }
};

exports.user_profile = async (req, res) => {
  try {
    await ensureSeedData();
    const profileData = await learningService.getAdminUserLearningProfileData(req.params.userId);

    return res.render('admin_learning_user_profile', profileData);
  } catch (error) {
    logger.error('Unable to render learning user profile', {
      category: 'learning_admin',
      metadata: {
        userId: String(req.user?._id || ''),
        viewedUserId: req.params.userId,
        error: error.message,
      },
    });

    return res.status(error?.statusCode || 500).render('error_page', {
      error: error.message || 'Unable to open this learning user profile.',
    });
  }
};
