const OpenAISubscriptionPlan = require('../../models/openai_subscription_plan');

describe('OpenAISubscriptionPlan model', () => {
  test('defines one unique start date index', () => {
    const startDateIndexes = OpenAISubscriptionPlan.schema.indexes()
      .filter(([keys]) => keys.startDate === 1);

    expect(startDateIndexes).toEqual([
      [{ startDate: 1 }, { unique: true }],
    ]);
  });
});
