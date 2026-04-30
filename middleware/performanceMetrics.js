module.exports = function createPerformanceMetricsMiddleware(metricsService) {
  return (req, res, next) => {
    const startTime = metricsService.beginRequest();
    let recorded = false;

    const record = () => {
      if (recorded) {
        return;
      }
      recorded = true;
      metricsService.endRequest(startTime, req, res);
    };

    res.once('finish', record);
    res.once('close', record);
    next();
  };
};
