const PendingRequests = require('../../models/pending_requests');

describe('PendingRequests recovery fields', () => {
  test('new pending work starts active and becomes due after one minute', () => {
    const before = Date.now();
    const pending = new PendingRequests({
      response_id: 'resp-new',
      conversation_id: 'conv-new',
      placeholder_id: 'placeholder-new',
    });
    const after = Date.now();

    expect(pending.recoveryState).toBe('pending');
    expect(pending.provider).toBe('OpenAI');
    expect(pending.toolRound).toBe(1);
    expect(pending.recoveryAttemptCount).toBe(0);
    expect(pending.nextCheckAt).toBeInstanceOf(Date);
    expect(pending.nextCheckAt.getTime()).toBeGreaterThanOrEqual(before + (60 * 1000));
    expect(pending.nextCheckAt.getTime()).toBeLessThanOrEqual(after + (60 * 1000));
  });
});
