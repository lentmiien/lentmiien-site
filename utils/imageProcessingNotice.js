module.exports = function imageProcessingNotice(stats) {
  const changes = [];
  for (const action of ['resized', 'dropped']) {
    const count = stats?.[action];
    if (Number.isSafeInteger(count) && count > 0) {
      changes.push(`${action} ${count} image${count === 1 ? '' : 's'}`);
    }
  }
  return changes.length ? `The Gateway ${changes.join(' and ')} for this response.` : '';
};
