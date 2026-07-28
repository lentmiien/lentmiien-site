function isAiGatewayDashboardStatusAccepted(endpointKey, status) {
  const isSuccess = status >= 200 && status < 300;
  const isDegradedHealth = endpointKey === 'health' && status === 503;

  return isSuccess || isDegradedHealth;
}

module.exports = {
  isAiGatewayDashboardStatusAccepted,
};
