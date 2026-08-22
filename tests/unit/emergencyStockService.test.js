const {
  buildEmergencyStockSnapshot,
  buildFiveDayMenuExercise,
  buildShoppingRequirements,
  dateKeyInTimeZone,
  getCurrentMilestone,
} = require('../../services/emergencyStockService');

const NOW = new Date('2026-08-22T03:00:00.000Z');

function category(id, overrides = {}) {
  return {
    _id: id,
    name: id,
    unit: 'items',
    recommendedStock: 0,
    managementMode: 'rolling',
    preparednessDomain: 'other',
    applicable: true,
    ...overrides,
  };
}

function item(id, categoryId, amount, overrides = {}) {
  return {
    _id: id,
    categoryId,
    amount,
    status: 'active',
    ...overrides,
  };
}

function coreFixture(extraCategories = [], extraItems = []) {
  const categories = [
    category('water', {
      name: 'Bottled water',
      unit: 'L',
      preparednessDomain: 'water',
      officialBaseline: 27,
      personalTarget: 63,
      emergencyFloor: 27,
      reorderPoint: 27,
      restockToAmount: 36,
      contributionPerUnit: { domainUnits: 1 },
    }),
    category('toilet', {
      name: 'Portable toilets',
      unit: 'uses',
      managementMode: 'expiry-managed',
      preparednessDomain: 'toilet',
      officialBaseline: 45,
      personalTarget: 105,
      contributionPerUnit: { domainUnits: 1 },
    }),
    category('complete-food', {
      name: 'Complete meals',
      unit: 'meals',
      preparednessDomain: 'food',
      contributionPerUnit: { completeMeals: 1 },
    }),
    ...extraCategories,
  ];
  const items = [
    item('water-lot', 'water', 26),
    item('toilet-lot', 'toilet', 50, { expiresAt: new Date('2028-01-01T00:00:00.000Z') }),
    item('meal-lot', 'complete-food', 36),
    ...extraItems,
  ];
  return { categories, items };
}

describe('Emergency Stock v2 calculations', () => {
  test('calculates core days from the limiting essential domain', () => {
    const fixture = coreFixture();
    const snapshot = buildEmergencyStockSnapshot({ ...fixture, now: NOW });

    expect(snapshot.core).toMatchObject({
      measurable: true,
      days: 2.9,
      limitingDomains: ['water'],
      status: 'nearly-floor',
    });
    expect(snapshot.domains.toilet.days).toBe(3.3);
    expect(snapshot.milestone).toMatchObject({ targetDays: 4, deadlineKey: '2026-09-30' });
  });

  test('excludes N/A categories from checklist readiness', () => {
    const fixture = coreFixture([
      category('not-applicable', {
        name: 'Menstrual products',
        applicable: false,
        recommendedStock: 100,
        officialBaseline: 100,
      }),
    ]);
    const snapshot = buildEmergencyStockSnapshot({ ...fixture, now: NOW });

    expect(snapshot.checklist.applicable).toBe(3);
    expect(snapshot.categories.find(entry => entry.id === 'not-applicable')).toMatchObject({
      health: 'not-applicable',
      percent: null,
      ready: true,
    });
  });

  test('durable equipment never inflates preparedness days', () => {
    const fixture = coreFixture([
      category('bags', {
        name: 'Emergency bags',
        managementMode: 'durable',
        recommendedStock: 1,
        officialBaseline: 1,
      }),
    ], [
      item('bag-1', 'bags', 100, {
        lastVerifiedAt: NOW,
        inspectionDueAt: new Date('2027-02-22T00:00:00.000Z'),
      }),
    ]);
    const withBag = buildEmergencyStockSnapshot({ ...fixture, now: NOW });
    const withoutBag = buildEmergencyStockSnapshot({
      categories: fixture.categories.filter(entry => entry._id !== 'bags'),
      items: fixture.items.filter(entry => entry.categoryId !== 'bags'),
      now: NOW,
    });

    expect(withBag.core.days).toBe(withoutBag.core.days);
    expect(withBag.durableHealth.verified).toBe(1);
  });

  test('reaching a rolling reorder point creates one package-aware requirement', () => {
    const categories = [category('paper', {
      name: 'Toilet paper',
      unit: 'rolls',
      emergencyFloor: 10,
      reorderPoint: 12,
      restockToAmount: 20,
      officialBaseline: 10,
      packageSize: 4,
    })];

    expect(buildShoppingRequirements({
      categories,
      items: [item('paper-lot', 'paper', 13)],
      now: NOW,
    })).toEqual([]);

    const requirements = buildShoppingRequirements({
      categories,
      items: [item('paper-lot', 'paper', 12)],
      now: NOW,
    });
    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({
      fingerprint: 'rolling:paper',
      trigger: 'reorder-point',
      requiredAmount: 8,
      currentAmount: 12,
      targetAmount: 20,
    });
  });

  test('derives the reorder point from floor and consumption before the next shop', () => {
    const categories = [category('wipes', {
      name: 'Wipes',
      unit: 'packs',
      emergencyFloor: 10,
      normalConsumptionRate: 30,
      consumptionPeriodDays: 30,
      shoppingLeadDays: 7,
      restockToAmount: 25,
    })];
    const snapshot = buildEmergencyStockSnapshot({
      categories,
      items: [item('wipes-lot', 'wipes', 17)],
      now: NOW,
    });

    expect(snapshot.categories[0].reorderPoint).toBe(17);
    expect(snapshot.categories[0].health).toBe('reorder-soon');
  });

  test('advance expiry warnings do not remove stock before the actual date', () => {
    const categories = [category('reserve', {
      name: 'Seasonal hand warmers',
      unit: 'packs',
      managementMode: 'expiry-managed',
      officialBaseline: 10,
      recommendedStock: 10,
      milestones: [{ deadline: new Date('2026-09-30T00:00:00.000Z'), target: 10 }],
    })];
    const items = [item('reserve-lot', 'reserve', 10, {
      expiresAt: new Date('2026-09-10T00:00:00.000Z'),
    })];
    const snapshot = buildEmergencyStockSnapshot({ categories, items, now: NOW });
    const requirements = buildShoppingRequirements({ categories, items, now: NOW });

    expect(snapshot.categories[0].stock).toBe(10);
    expect(snapshot.categories[0].items[0]).toMatchObject({ counted: true, state: 'expiry-soon' });
    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ fingerprint: 'reserve:reserve', trigger: 'expiring-soon' }),
    ]));
  });

  test('combines multiple upcoming rotations into one non-duplicated replacement need', () => {
    const categories = [category('reserve', {
      name: 'Seasonal hand warmers',
      unit: 'packs',
      managementMode: 'expiry-managed',
      officialBaseline: 10,
      milestones: [{ deadline: new Date('2026-09-30T00:00:00.000Z'), target: 10 }],
    })];
    const items = [
      item('lot-1', 'reserve', 5, { expiresAt: new Date('2026-08-27T00:00:00.000Z') }),
      item('lot-2', 'reserve', 5, { expiresAt: new Date('2026-09-01T00:00:00.000Z') }),
      item('lot-3', 'reserve', 5, { expiresAt: new Date('2026-09-11T00:00:00.000Z') }),
    ];
    const requirements = buildShoppingRequirements({ categories, items, now: NOW });

    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({
      fingerprint: 'reserve:reserve',
      requiredAmount: 10,
      currentAmount: 15,
      targetAmount: 10,
      trigger: 'expiring-soon',
    });
  });

  test('pools substitutable staples and limits meal capacity by complementary mains', () => {
    const categories = [
      category('dry-rice', {
        name: 'Dry rice',
        unit: 'kg',
        preparednessDomain: 'food',
        contributionPerUnit: { stapleServings: 1000 / 75 },
      }),
      category('ready-rice', {
        name: 'Ready rice',
        unit: 'servings',
        preparednessDomain: 'food',
        contributionPerUnit: { stapleServings: 1 },
      }),
      category('mains', {
        name: 'Main-dish servings',
        unit: 'servings',
        preparednessDomain: 'food',
        contributionPerUnit: { mainDishServings: 1 },
      }),
    ];
    const items = [
      item('dry-rice-lot', 'dry-rice', 2),
      item('ready-rice-lot', 'ready-rice', 26),
      item('mains-lot', 'mains', 36),
    ];
    const snapshot = buildEmergencyStockSnapshot({ categories, items, now: NOW });

    expect(snapshot.domains.food.details.stapleServings).toBe(52.67);
    expect(snapshot.domains.food.details.mealCapacity).toBe(36);
    expect(snapshot.domains.food.days).toBe(4);
  });

  test('allows mixed food lots to override an ambiguous category rule', () => {
    const categories = [category('canned-food', {
      name: 'Canned food',
      unit: 'cans',
      preparednessDomain: 'food',
    })];
    const items = [
      item('canned-main', 'canned-food', 9, {
        contributionOverride: { mainDishServings: 1 },
      }),
      item('canned-meal', 'canned-food', 9, {
        contributionOverride: { completeMeals: 1, noCookMeals: 1 },
      }),
    ];
    const snapshot = buildEmergencyStockSnapshot({ categories, items, now: NOW });

    expect(snapshot.domains.food.measurable).toBe(true);
    expect(snapshot.domains.food.details).toMatchObject({
      completeMeals: 9,
      mainDishServings: 9,
      noCookMeals: 9,
      mealCapacity: 9,
    });
  });

  test('uses Tokyo calendar boundaries for monthly milestones', () => {
    const beforeTokyoOctober = new Date('2026-09-30T14:59:59.000Z');
    const afterTokyoOctober = new Date('2026-09-30T15:00:00.000Z');

    expect(dateKeyInTimeZone(beforeTokyoOctober, 'Asia/Tokyo')).toBe('2026-09-30');
    expect(getCurrentMilestone({}, beforeTokyoOctober).targetDays).toBe(4);
    expect(dateKeyInTimeZone(afterTokyoOctober, 'Asia/Tokyo')).toBe('2026-10-01');
    expect(getCurrentMilestone({}, afterTokyoOctober).targetDays).toBe(5);
  });

  test('uses the staged gas-canister targets instead of scaling directly to seven days', () => {
    const categories = [category('gas', {
      name: 'Gas canisters',
      unit: 'canisters',
      managementMode: undefined,
      preparednessDomain: 'other',
      recommendedStock: 12,
    })];
    const items = [item('gas-lot', 'gas', 12, {
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    })];

    const september = buildEmergencyStockSnapshot({ categories, items, now: NOW });
    const october = buildEmergencyStockSnapshot({
      categories,
      items,
      now: new Date('2026-10-01T03:00:00.000Z'),
    });

    expect(september.categories[0]).toMatchObject({ target: 12, health: 'healthy' });
    expect(october.categories[0]).toMatchObject({ target: 13, health: 'below-target' });
  });

  test('five-day menu exercise exposes water, fuel, and complementary-food gaps', () => {
    const menu = buildFiveDayMenuExercise([{
      _id: 'meal-1',
      day: 1,
      meal: 'breakfast',
      label: 'Rice only',
      servings: 3,
      stapleSource: 'Ready rice',
      mainDishSource: '',
      noCook: false,
      requiresFuel: true,
      waterLitresRequired: 0.6,
    }], { householdSize: 3, mealsPerPersonDay: 3 });

    expect(menu).toMatchObject({
      requiredServings: 45,
      plannedServings: 3,
      gap: 42,
      fuelServings: 3,
      waterLitresRequired: 0.6,
      missingMainDishServings: 3,
      complete: false,
    });
    expect(menu.missingSlots).toHaveLength(14);
  });
});
