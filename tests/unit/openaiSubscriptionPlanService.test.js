const {
  buildMonthRange,
  buildSubscriptionRows,
  findAppliedPlanForMonth,
  sortSubscriptionPlans,
} = require('../../services/openaiSubscriptionPlanService');

describe('openaiSubscriptionPlanService', () => {
  test('defaults to Free before the first saved plan', () => {
    const plans = sortSubscriptionPlans([
      { planName: 'Pro', monthlyCost: 100, startDate: '2026-05-15' },
    ]);

    const appliedPlan = findAppliedPlanForMonth(plans, '2026-04');

    expect(appliedPlan.planName).toBe('Free');
    expect(appliedPlan.monthlyCost).toBe(0);
  });

  test('applies a mid-month plan to that billing month', () => {
    const rows = buildSubscriptionRows(['2026-05', '2026-06'], [
      { planName: 'Pro', monthlyCost: 100, startDate: '2026-05-15' },
      { planName: 'Plus', monthlyCost: 20, startDate: '2026-06-14' },
    ]);

    expect(rows[0]).toMatchObject({
      month: '2026-05',
      planName: 'Pro',
      subscriptionCost: 100,
    });
    expect(rows[1]).toMatchObject({
      month: '2026-06',
      planName: 'Plus',
      subscriptionCost: 20,
    });
  });

  test('applies a Free plan as zero from its start month', () => {
    const rows = buildSubscriptionRows(['2026-06', '2026-07'], [
      { planName: 'Plus', monthlyCost: 20, startDate: '2026-06-01' },
      { planName: 'Free', monthlyCost: 0, startDate: '2026-07-20' },
    ]);

    expect(rows[0].subscriptionCost).toBe(20);
    expect(rows[1]).toMatchObject({
      planName: 'Free',
      subscriptionCost: 0,
    });
  });

  test('uses the latest plan change inside a month for that month', () => {
    const rows = buildSubscriptionRows(['2026-06'], [
      { planName: 'Pro', monthlyCost: 100, startDate: '2026-05-15' },
      { planName: 'Plus', monthlyCost: 20, startDate: '2026-06-12' },
      { planName: 'Free', monthlyCost: 0, startDate: '2026-06-25' },
    ]);

    expect(rows[0]).toMatchObject({
      planName: 'Free',
      subscriptionCost: 0,
    });
  });

  test('builds inclusive month ranges', () => {
    expect(buildMonthRange('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });
});
