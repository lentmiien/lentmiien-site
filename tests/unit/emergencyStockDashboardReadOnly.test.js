const categories = [];
const items = [];

function query(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

const mockDatabase = {
  ESCategory: {
    find: jest.fn(() => query(categories)),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
  ESItem: {
    find: jest.fn(() => query(items)),
    deleteMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
  ESProfile: {
    findOne: jest.fn(() => query(null)),
    findOneAndUpdate: jest.fn(),
  },
  ESShoppingRequirement: {
    find: jest.fn(() => query([])),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
  ESMenuEntry: {
    find: jest.fn(() => query([])),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  },
};

jest.mock('../../database', () => mockDatabase);
jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

const controller = require('../../controllers/escontroller');

describe('Emergency Stock dashboard reads', () => {
  test('loading the dashboard never modifies inventory or policy data', async () => {
    const res = {
      render: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await controller.es_dashboard({}, res);

    expect(res.render).toHaveBeenCalledWith('es_dashboard', expect.objectContaining({
      snapshot: expect.any(Object),
      forecast: expect.any(Object),
    }));
    expect(res.status).not.toHaveBeenCalled();
    expect(mockDatabase.ESItem.deleteMany).not.toHaveBeenCalled();
    expect(mockDatabase.ESItem.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mockDatabase.ESCategory.updateOne).not.toHaveBeenCalled();
    expect(mockDatabase.ESCategory.updateMany).not.toHaveBeenCalled();
    expect(mockDatabase.ESProfile.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mockDatabase.ESShoppingRequirement.updateOne).not.toHaveBeenCalled();
    expect(mockDatabase.ESShoppingRequirement.updateMany).not.toHaveBeenCalled();
    expect(mockDatabase.ESMenuEntry.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mockDatabase.ESMenuEntry.deleteOne).not.toHaveBeenCalled();
  });
});
