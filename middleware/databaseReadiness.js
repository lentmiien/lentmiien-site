const mongoose = require('mongoose');

function isDatabaseReady(mongooseLib = mongoose) {
  return mongooseLib?.connection?.readyState === 1;
}

function createDatabaseHealthHandler({ mongooseLib = mongoose } = {}) {
  return (_req, res) => {
    const ready = isDatabaseReady(mongooseLib);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable',
      database: ready ? 'ready' : 'unavailable',
    });
  };
}

function createDatabaseReadinessMiddleware({ mongooseLib = mongoose } = {}) {
  return (_req, res, next) => {
    if (isDatabaseReady(mongooseLib)) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '5');
    return res.status(503).json({
      status: 'unavailable',
      message: 'Service temporarily unavailable.',
    });
  };
}

module.exports = {
  createDatabaseHealthHandler,
  createDatabaseReadinessMiddleware,
  isDatabaseReady,
};
