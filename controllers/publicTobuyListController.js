const { Task } = require('../database');
const logger = require('../utils/logger');
const {
  PUBLIC_TOBUY_LIST_OWNER,
  consumePublicTobuyAddQuota,
} = require('../utils/publicTobuyList');

const MAX_TITLE_LENGTH = 200;

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getSubmitPath(req) {
  return req.baseUrl || req.path || '/';
}

async function fetchOpenTasks() {
  const tasks = await Task.find({
    userId: PUBLIC_TOBUY_LIST_OWNER,
    type: 'tobuy',
    done: false,
  }).sort({ createdAt: 1, _id: 1 }).lean();

  return (tasks || []).map((task) => ({
    id: task._id ? task._id.toString() : '',
    title: task.title || 'Untitled item',
  }));
}

async function renderPage(req, res, options = {}) {
  const tasks = options.tasks || await fetchOpenTasks();
  const errorMessage = options.errorMessage || null;
  const successMessage = options.successMessage || (req.query.added === '1'
    ? 'Item added.'
    : null);
  const statusCode = options.statusCode || 200;

  res.locals.og_title = 'Lennart\'s Website - Shared to-buy list';
  res.locals.twitter_title = 'Lennart\'s Website - Shared to-buy list';

  return res.status(statusCode).render('public_tobuy_list', {
    taskCount: tasks.length,
    tasks,
    errorMessage,
    successMessage,
    formTitle: options.formTitle || '',
    submitPath: getSubmitPath(req),
  });
}

exports.renderPublicPage = async (req, res) => {
  try {
    return await renderPage(req, res);
  } catch (error) {
    logger.error('Failed to load public to-buy list', {
      category: 'public-tobuy',
      metadata: { error: error.message },
    });
    return res.status(500).send('Unable to load the to-buy list.');
  }
};

exports.addPublicTask = async (req, res) => {
  const title = normalizeTitle(req.body && req.body.title);

  try {
    if (!title) {
      return await renderPage(req, res, {
        statusCode: 400,
        errorMessage: 'Enter an item to add.',
      });
    }

    if (title.length > MAX_TITLE_LENGTH) {
      return await renderPage(req, res, {
        statusCode: 400,
        errorMessage: `Items must stay under ${MAX_TITLE_LENGTH} characters.`,
        formTitle: title,
      });
    }

    const quota = consumePublicTobuyAddQuota();
    if (!quota.allowed) {
      const errorMessage = quota.reason === 'too_fast'
        ? 'Please wait one second before adding another item.'
        : 'The shared add limit for today has been reached.';

      return await renderPage(req, res, {
        statusCode: 429,
        errorMessage,
        formTitle: title,
      });
    }

    const doc = new Task({
      userId: PUBLIC_TOBUY_LIST_OWNER,
      type: 'tobuy',
      title,
      description: '',
      start: null,
      end: null,
      done: false,
    });

    await doc.save();
    return res.redirect(`${getSubmitPath(req)}?added=1`);
  } catch (error) {
    logger.error('Failed to add item to public to-buy list', {
      category: 'public-tobuy',
      metadata: { error: error.message },
    });

    try {
      return await renderPage(req, res, {
        statusCode: 500,
        errorMessage: 'Unable to add the item right now.',
        formTitle: title,
      });
    } catch (_) {
      return res.status(500).send('Unable to add the item.');
    }
  }
};
