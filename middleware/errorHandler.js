function createErrorHandler(logger) {
  return (error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const requestedStatus = Number(error?.status || error?.statusCode);
    const statusCode = Number.isInteger(requestedStatus)
      && requestedStatus >= 400
      && requestedStatus < 600
      ? requestedStatus
      : 500;
    const publicMessage = statusCode < 500 && error?.expose === true
      ? error.message
      : statusCode < 500
        ? 'The request could not be processed.'
        : 'An unexpected server error occurred.';

    if (statusCode >= 500) {
      logger.error('Unhandled HTTP request failure', {
        category: 'http',
        metadata: {
          method: req.method,
          statusCode,
          errorName: error?.name || 'Error',
          errorCode: error?.code || null,
        },
      });
    }

    const wantsJson = req.originalUrl?.startsWith('/api')
      || req.xhr
      || String(req.get?.('accept') || '').includes('application/json');
    if (wantsJson) {
      return res.status(statusCode).json({ error: publicMessage });
    }
    return res.status(statusCode).render('error_page', { error: publicMessage });
  };
}

module.exports = createErrorHandler;
