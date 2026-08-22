const {
  buildEmergencyStockSnapshot,
  buildFiveDayMenuExercise,
  buildMilestoneForecast,
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
      category('paper', {
        name: 'Toilet paper',
        officialBaseline: 1,
        targetStrategy: 'fixed',
      }),
      category('not-applicable', {
        name: 'Menstrual products',
        applicable: false,
        recommendedStock: 100,
        officialBaseline: 100,
      }),
    ], [item('paper-lot', 'paper', 1)]);
    const snapshot = buildEmergencyStockSnapshot({ ...fixture, now: NOW });

    expect(snapshot.checklist).toMatchObject({ applicable: 1, ready: 1, percent: 100 });
    expect(snapshot.categories.find(entry => entry.id === 'not-applicable')).toMatchObject({
      health: 'not-applicable',
      percent: null,
      ready: null,
    });
  });

  test('holds conditional categories in an applicability decision state without shopping', () => {
    const categories = [category('menstrual', {
      name: 'Menstrual products (if applicable)',
      conditional: true,
      applicable: true,
      emergencyFloor: 40,
      reorderPoint: 40,
      restockToAmount: 40,
      targetStrategy: 'fixed',
    })];
    const snapshot = buildEmergencyStockSnapshot({ categories, items: [], now: NOW });

    expect(snapshot.categories[0]).toMatchObject({
      applicable: false,
      applicabilityStatus: 'undecided',
      needsApplicabilityDecision: true,
      health: 'applicability-undecided',
    });
    expect(snapshot.applicabilityReview.due).toBe(1);
    expect(buildShoppingRequirements({ categories, items: [], now: NOW })).toEqual([]);
  });

  test('durable equipment never inflates preparedness days', () => {
    const fixture = coreFixture([
      category('bags', {
        name: 'Emergency bags',
        managementMode: 'durable',
        recommendedStock: 1,
        officialBaseline: 1,
        applicabilityStatus: 'applicable',
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

  test('forecasts dated rolling stock through the milestone and buys before expiry', () => {
    const categories = [category('masks', {
      name: 'Masks',
      unit: 'packs',
      emergencyFloor: 2,
      reorderPoint: 2,
      restockToAmount: 3,
      officialBaseline: 3,
      targetStrategy: 'fixed',
      shoppingLeadDays: 7,
    })];
    const items = [item('mask-lot', 'masks', 3, {
      expiresAt: new Date('2026-09-30T00:00:00.000Z'),
    })];
    const snapshot = buildEmergencyStockSnapshot({ categories, items, now: NOW });
    const requirements = buildShoppingRequirements({ categories, items, now: NOW });

    expect(snapshot.categories[0]).toMatchObject({ stock: 3, health: 'healthy' });
    expect(snapshot.categories[0].items[0].state).toBe('current');
    expect(requirements).toEqual([
      expect.objectContaining({
        fingerprint: 'rolling:masks',
        trigger: 'expiring-soon',
        requiredAmount: 3,
        currentAmount: 3,
        forecastAmount: 0,
        dueDate: new Date('2026-09-23T00:00:00.000Z'),
      }),
    ]);
  });

  test('treats legacy 15:00Z expiry timestamps as their stored date for purchase deadlines', () => {
    const categories = [category('beverages', {
      name: 'Beverages',
      unit: 'bottles',
      emergencyFloor: 2,
      reorderPoint: 2,
      restockToAmount: 3,
      officialBaseline: 3,
      targetStrategy: 'fixed',
      shoppingLeadDays: 7,
    })];
    const items = [item('beverage-lot', 'beverages', 3, {
      expiresAt: new Date('2026-08-31T15:00:00.000Z'),
    })];

    const requirement = buildShoppingRequirements({ categories, items, now: NOW })[0];

    expect(requirement).toMatchObject({
      fingerprint: 'rolling:beverages',
      trigger: 'expiring-soon',
      dueDate: new Date('2026-08-24T00:00:00.000Z'),
    });
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
    expect(snapshot.categories.find(entry => entry.id === 'dry-rice')).toMatchObject({
      targetManagedAtDomain: true,
      health: 'contributing',
      percent: null,
      ready: null,
    });
  });

  test('includes rotations on the milestone date in the food purchase requirement', () => {
    const fixture = coreFixture([
      category('staples', {
        name: 'Staple servings',
        unit: 'servings',
        preparednessDomain: 'food',
        contributionPerUnit: { stapleServings: 1 },
      }),
      category('mains', {
        name: 'Main dishes',
        unit: 'servings',
        preparednessDomain: 'food',
        contributionPerUnit: { mainDishServings: 1 },
        shoppingLeadDays: 7,
      }),
    ], [
      item('staples-lot', 'staples', 58),
      item('mains-stable', 'mains', 13),
      item('mains-august', 'mains', 3, { expiresAt: new Date('2026-08-31T00:00:00.000Z') }),
      item('mains-september', 'mains', 3, { expiresAt: new Date('2026-09-30T00:00:00.000Z') }),
    ]);
    fixture.items = fixture.items.filter(entry => entry.categoryId !== 'complete-food');

    const snapshot = buildEmergencyStockSnapshot({ ...fixture, now: NOW });
    const forecast = buildMilestoneForecast({ ...fixture, now: NOW });
    const requirement = buildShoppingRequirements({ ...fixture, now: NOW })
      .find(entry => entry.fingerprint === 'milestone:food');

    expect(snapshot.domains.food.currentAmount).toBe(19);
    expect(forecast).toMatchObject({ throughDateKey: '2026-09-30', dateKey: '2026-10-01' });
    expect(forecast.domains.food.currentAmount).toBe(13);
    expect(requirement).toMatchObject({
      requiredAmount: 23,
      currentAmount: 19,
      forecastAmount: 13,
      trigger: 'expiring-soon',
      dueDate: new Date('2026-08-24T00:00:00.000Z'),
    });
    expect(requirement.reason).toContain('staple pool already covers this milestone');
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

  test('surfaces unclassified food with a clearly separate possible impact', () => {
    const fixture = coreFixture([
      category('ambiguous-food', {
        name: 'Nutritional supplement boxes',
        unit: 'boxes',
        preparednessDomain: 'food',
      }),
    ], [item('unknown-food', 'ambiguous-food', 10, { label: 'Check nutrition label' })]);
    const snapshot = buildEmergencyStockSnapshot({ ...fixture, now: NOW });

    expect(snapshot.domains.food.currentAmount).toBe(36);
    expect(snapshot.unclassifiedFood).toMatchObject({
      count: 1,
      possibleMeals: 10,
      possibleFoodDays: 5.1,
    });
    expect(snapshot.unclassifiedFood.items[0]).toMatchObject({
      id: 'unknown-food',
      categoryName: 'Nutritional supplement boxes',
      possibleMeals: 10,
    });
  });

  test('classifies supplemental food without adding it to core meal capacity', () => {
    const fixture = coreFixture([
      category('snacks', {
        name: 'Cheese and protein bars',
        unit: 'bars',
        preparednessDomain: 'food',
      }),
    ], [item('snack-lot', 'snacks', 10, {
      foodRole: 'supplemental',
      contributionOverride: {
        supplementalServings: 1,
        noCookMeals: 1,
      },
    })]);
    const snapshot = buildEmergencyStockSnapshot({ ...fixture, now: NOW });

    expect(snapshot.domains.food.currentAmount).toBe(36);
    expect(snapshot.domains.food.details).toMatchObject({
      mealCapacity: 36,
      supplementalServings: 10,
      noCookMeals: 10,
    });
    expect(snapshot.unclassifiedFood).toMatchObject({ count: 0, possibleMeals: 0 });
  });

  test('normalizes metric water units and flags implausible coverage', () => {
    const safe = buildEmergencyStockSnapshot({
      categories: [category('water-ml', {
        name: 'Drinking water',
        unit: 'mL',
        preparednessDomain: 'water',
      })],
      items: [item('water-bottle', 'water-ml', 2000)],
      now: NOW,
    });
    expect(safe.domains.water.currentAmount).toBe(2);
    expect(safe.sanityWarnings).toEqual([]);

    const unsafe = buildEmergencyStockSnapshot({
      categories: [category('water-bad', {
        name: 'Drinking water',
        unit: 'mL',
        preparednessDomain: 'water',
        contributionPerUnit: { domainUnits: 1 },
      })],
      items: [item('water-stock', 'water-bad', 26000)],
      now: NOW,
    });
    expect(unsafe.sanityWarnings).toEqual([
      expect.objectContaining({ code: 'implausible-water-coverage', domain: 'water' }),
    ]);
  });

  test('keeps fixed targets whole while duration-scaled targets follow the milestone', () => {
    const snapshot = buildEmergencyStockSnapshot({
      categories: [
        category('foil', {
          name: 'Aluminium foil',
          officialBaseline: 1,
          personalTarget: 1,
          targetStrategy: 'fixed',
        }),
        category('masks', {
          name: 'Masks',
          officialBaseline: 3,
          targetStrategy: 'duration-scaled',
        }),
      ],
      items: [],
      now: NOW,
    });

    expect(snapshot.categories.find(entry => entry.id === 'foil').target).toBe(1);
    expect(snapshot.categories.find(entry => entry.id === 'masks').target).toBe(4);
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
