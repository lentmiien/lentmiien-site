const foodCategory = {
  _id: 'supplements',
  name: 'Nutritional supplements',
  unit: 'boxes',
  managementMode: 'rolling',
  preparednessDomain: 'food',
  applicabilityStatus: 'applicable',
  applicable: true,
};
const foodItem = {
  _id: 'supplement-lot',
  categoryId: 'supplements',
  amount: 10,
  status: 'active',
};

function query(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

const mockDatabase = {
  ESCategory: {
    findById: jest.fn(() => query(foodCategory)),
    find: jest.fn(() => query([foodCategory])),
  },
  ESItem: {
    findById: jest.fn(() => query(foodItem)),
    findByIdAndUpdate: jest.fn().mockResolvedValue(foodItem),
    find: jest.fn(() => query([foodItem])),
  },
  ESProfile: {
    findOne: jest.fn(() => query(null)),
  },
  ESShoppingRequirement: {
    find: jest.fn(() => query([])),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
  ESMenuEntry: {},
  ESUnitConversion: {},
};

jest.mock('../../database', () => mockDatabase);
jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

const controller = require('../../controllers/escontroller');

describe('Emergency Stock controller', () => {
  test('stores supplemental food as a classified zero-core role', async () => {
    const req = {
      body: {
        item_id: 'supplement-lot',
        foodContributionType: 'supplemental',
        foodServingsPerUnit: '1',
        foodNoCook: 'on',
        foodWaterLitresRequired: '0',
      },
    };
    const res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await controller.classify_food_item(req, res);

    expect(mockDatabase.ESItem.findByIdAndUpdate).toHaveBeenCalledWith(
      'supplement-lot',
      {
        $set: {
          foodRole: 'supplemental',
          contributionOverride: {
            supplementalServings: 1,
            noCookMeals: 1,
            waterLitresRequired: 0,
            fuelMealsRequired: 0,
          },
        },
      },
      { new: true, runValidators: true },
    );
    expect(res.redirect).toHaveBeenCalledWith('/es/es_dashboard');
    expect(res.status).not.toHaveBeenCalled();
  });
});
