const TemplateService = require('../../services/templateService');

describe('TemplateService', () => {
  let TemplateModel;
  let templateService;

  beforeEach(() => {
    TemplateModel = jest.fn().mockImplementation((doc) => ({
      save: jest.fn().mockResolvedValue({
        _id: 'generated-id',
        ...doc
      })
    }));

    TemplateModel.find = jest.fn();
    TemplateModel.deleteOne = jest.fn();

    templateService = new TemplateService(TemplateModel);
  });

  test('getTemplates returns all templates', async () => {
    const fakeTemplates = [{ Title: 'Welcome' }, { Title: 'Reminder' }];
    TemplateModel.find.mockResolvedValue(fakeTemplates);

    const result = await templateService.getTemplates();

    expect(TemplateModel.find).toHaveBeenCalledTimes(1);
    expect(TemplateModel.find).toHaveBeenCalledWith();
    expect(result).toEqual(fakeTemplates);
  });

  test('getTemplatesByIdArray queries with ids', async () => {
    const ids = ['abc', 'def'];
    const fakeTemplates = [{ _id: 'abc' }];
    TemplateModel.find.mockResolvedValue(fakeTemplates);

    const result = await templateService.getTemplatesByIdArray(ids);

    expect(TemplateModel.find).toHaveBeenCalledWith({ _id: ids });
    expect(result).toEqual(fakeTemplates);
  });

  test('createTemplate saves a new template', async () => {
    const result = await templateService.createTemplate(
      'Title',
      'Type',
      'Category',
      'Body'
    );

    expect(TemplateModel).toHaveBeenCalledWith({
      Title: 'Title',
      Type: 'Type',
      Category: 'Category',
      TemplateText: 'Body'
    });

    const createdInstance = TemplateModel.mock.results[0].value;
    expect(createdInstance.save).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      _id: 'generated-id',
      Title: 'Title',
      Type: 'Type',
      Category: 'Category',
      TemplateText: 'Body'
    });
  });

  test('updateTemplate mutates and saves the template entry', async () => {
    const templateDoc = {
      Title: 'Old',
      Type: 'Old',
      Category: 'Old',
      TemplateText: 'Old',
      save: jest.fn().mockResolvedValue()
    };
    TemplateModel.find.mockResolvedValue([templateDoc]);

    const result = await templateService.updateTemplate(
      'template-id',
      'New Title',
      'New Type',
      'New Category',
      'New Text'
    );

    expect(TemplateModel.find).toHaveBeenCalledWith({ _id: 'template-id' });
    expect(templateDoc.Title).toBe('New Title');
    expect(templateDoc.Type).toBe('New Type');
    expect(templateDoc.Category).toBe('New Category');
    expect(templateDoc.TemplateText).toBe('New Text');
    expect(templateDoc.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(templateDoc);
  });

  test('deleteTemplateById removes template', async () => {
    TemplateModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

    await templateService.deleteTemplateById('template-id');

    expect(TemplateModel.deleteOne).toHaveBeenCalledWith({ _id: 'template-id' });
  });
});
