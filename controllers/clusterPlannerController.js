const clusterPlannerService = require('../services/clusterPlannerService');
const logger = require('../utils/logger');

function stringifyForScript(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function renderPageError(res, error, fallbackMessage) {
  const status = error?.statusCode || 500;
  const message = error?.message || fallbackMessage;
  return res.status(status).render('error_page', { error: message });
}

function renderJsonError(res, error, fallbackMessage) {
  const status = error?.statusCode || 500;
  const message = error?.message || fallbackMessage;
  return res.status(status).json({ status: 'error', message });
}

exports.home = async (req, res) => {
  try {
    const state = await clusterPlannerService.getState();
    return res.render('ai_cluster_planner', {
      clusterPlannerBootstrapJson: stringifyForScript(state),
    });
  } catch (error) {
    logger.error('Unable to render AI cluster planner', {
      category: 'cluster_planner',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });
    return renderPageError(res, error, 'Unable to open the AI cluster planner right now.');
  }
};

exports.state = async (req, res) => {
  try {
    const state = await clusterPlannerService.getState();
    return res.json(state);
  } catch (error) {
    logger.warning('Unable to load AI cluster planner state', {
      category: 'cluster_planner',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });
    return renderJsonError(res, error, 'Unable to load planner state.');
  }
};

exports.save_inventory = async (req, res) => {
  try {
    const item = await clusterPlannerService.saveInventoryItem(req.body || {});
    return res.json({ status: 'ok', item });
  } catch (error) {
    logger.warning('Unable to save AI cluster planner inventory item', {
      category: 'cluster_planner',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });
    return renderJsonError(res, error, 'Unable to save inventory item.');
  }
};

exports.delete_inventory = async (req, res) => {
  try {
    await clusterPlannerService.deleteInventoryItem(req.params.id);
    return res.json({ status: 'ok' });
  } catch (error) {
    logger.warning('Unable to delete AI cluster planner inventory item', {
      category: 'cluster_planner',
      metadata: {
        userId: String(req.user?._id || ''),
        itemId: req.params.id,
        error: error.message,
      },
    });
    return renderJsonError(res, error, 'Unable to delete inventory item.');
  }
};

exports.save_node_type = async (req, res) => {
  try {
    const nodeType = await clusterPlannerService.saveNodeType(req.params.id, req.body || {});
    return res.json({ status: 'ok', nodeType });
  } catch (error) {
    logger.warning('Unable to save AI cluster planner node type', {
      category: 'cluster_planner',
      metadata: {
        userId: String(req.user?._id || ''),
        nodeTypeId: req.params.id,
        error: error.message,
      },
    });
    return renderJsonError(res, error, 'Unable to save node type.');
  }
};

exports.save_hardware = async (req, res) => {
  try {
    const item = await clusterPlannerService.saveHardwareItem(req.body || {});
    return res.json({ status: 'ok', item });
  } catch (error) {
    logger.warning('Unable to save AI cluster planner hardware entry', {
      category: 'cluster_planner',
      metadata: {
        userId: String(req.user?._id || ''),
        error: error.message,
      },
    });
    return renderJsonError(res, error, 'Unable to save hardware entry.');
  }
};

exports.delete_hardware = async (req, res) => {
  try {
    await clusterPlannerService.deleteHardwareItem(req.params.id);
    return res.json({ status: 'ok' });
  } catch (error) {
    logger.warning('Unable to delete AI cluster planner hardware entry', {
      category: 'cluster_planner',
      metadata: {
        userId: String(req.user?._id || ''),
        itemId: req.params.id,
        error: error.message,
      },
    });
    return renderJsonError(res, error, 'Unable to delete hardware entry.');
  }
};
