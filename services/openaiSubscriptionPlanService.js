const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DEFAULT_SUBSCRIPTION_PLAN = Object.freeze({
  id: null,
  planName: 'Free',
  monthlyCost: 0,
  startDate: null,
  isDefaultPlan: true,
});

function roundCurrency(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(Math.max(0, numericValue) * 100) / 100;
}

function monthKeyFromDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }

  const month = String(value.getMonth() + 1).padStart(2, '0');
  return `${value.getFullYear()}-${month}`;
}

function monthKeyFromDateString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || month < 1
    || month > 12
  ) {
    return null;
  }

  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}`;
}

function labelForMonth(monthKey) {
  if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return monthKey || '';
  }

  const [yearStr, monthStr] = monthKey.split('-');
  const monthIndex = Number.parseInt(monthStr, 10) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    return monthKey;
  }

  return `${MONTH_NAMES[monthIndex]} ${yearStr}`;
}

function nextMonthKey(monthKey) {
  if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return null;
  }

  const [yearStr, monthStr] = monthKey.split('-');
  let year = Number.parseInt(yearStr, 10);
  let month = Number.parseInt(monthStr, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  month += 1;
  if (month > 12) {
    year += 1;
    month = 1;
  }

  return `${year}-${String(month).padStart(2, '0')}`;
}

function buildMonthRange(startMonth, endMonth) {
  if (
    typeof startMonth !== 'string'
    || typeof endMonth !== 'string'
    || !/^\d{4}-\d{2}$/.test(startMonth)
    || !/^\d{4}-\d{2}$/.test(endMonth)
    || startMonth > endMonth
  ) {
    return [];
  }

  const months = [];
  let month = startMonth;
  let guard = 0;
  while (month && month <= endMonth && guard < 1200) {
    months.push(month);
    month = nextMonthKey(month);
    guard += 1;
  }

  return months;
}

function normalizeSubscriptionPlan(plan) {
  if (!plan) {
    return null;
  }

  const startDate = typeof plan.startDate === 'string' ? plan.startDate : null;
  if (!monthKeyFromDateString(startDate)) {
    return null;
  }

  const planName = typeof plan.planName === 'string' && plan.planName.trim()
    ? plan.planName.trim()
    : 'Unnamed plan';

  return {
    id: plan._id ? String(plan._id) : (plan.id ? String(plan.id) : null),
    planName,
    monthlyCost: roundCurrency(plan.monthlyCost),
    startDate,
    isDefaultPlan: false,
  };
}

function sortSubscriptionPlans(plans) {
  return (Array.isArray(plans) ? plans : [])
    .map(normalizeSubscriptionPlan)
    .filter(Boolean)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function findAppliedPlanForMonth(sortedPlans, monthKey) {
  if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return DEFAULT_SUBSCRIPTION_PLAN;
  }

  const monthEnd = `${monthKey}-31`;
  let appliedPlan = DEFAULT_SUBSCRIPTION_PLAN;
  for (const plan of sortedPlans) {
    if (plan.startDate <= monthEnd) {
      appliedPlan = plan;
    } else {
      break;
    }
  }

  return appliedPlan;
}

function buildSubscriptionRows(monthKeys, plans) {
  const sortedPlans = sortSubscriptionPlans(plans);
  return (Array.isArray(monthKeys) ? monthKeys : []).map((month) => {
    const appliedPlan = findAppliedPlanForMonth(sortedPlans, month);
    return {
      month,
      label: labelForMonth(month),
      planName: appliedPlan.planName,
      planStartDate: appliedPlan.startDate,
      monthlyCost: appliedPlan.monthlyCost,
      subscriptionCost: appliedPlan.monthlyCost,
      isDefaultPlan: appliedPlan.isDefaultPlan,
    };
  });
}

module.exports = {
  DEFAULT_SUBSCRIPTION_PLAN,
  buildMonthRange,
  buildSubscriptionRows,
  findAppliedPlanForMonth,
  labelForMonth,
  monthKeyFromDate,
  monthKeyFromDateString,
  nextMonthKey,
  roundCurrency,
  sortSubscriptionPlans,
};
