const marked = require('marked');

const { CookbookRecipeModel, Chat4KnowledgeModel } = require('../database');
const logger = require('../utils/logger');

const DEFAULT_SORT = 'updated_desc';
const NUTRITION_LEVELS = ['high', 'medium', 'low'];
const DEFAULT_RATING_LABELS = [
  'my_overall_rating',
  'easy_to_cook',
  'taste',
  'son_likes',
  'cost_efficiency',
];
const SORT_OPTIONS = [
  { value: 'updated_desc', label: 'Updated (newest)' },
  { value: 'updated_asc', label: 'Updated (oldest)' },
  { value: 'title_asc', label: 'Title (A-Z)' },
  { value: 'title_desc', label: 'Title (Z-A)' },
  { value: 'calories_asc', label: 'Calories (low-high)' },
  { value: 'calories_desc', label: 'Calories (high-low)' },
  { value: 'cooking_time_asc', label: 'Cooking time (short-long)' },
  { value: 'cooking_time_desc', label: 'Cooking time (long-short)' },
];

function toDisplayDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch (error) {
    return '';
  }
}

function toNumberInput(value) {
  return Number.isFinite(value) ? String(value) : '';
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function parseCommaSeparated(input) {
  if (!input || typeof input !== 'string') return [];
  return input
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseNumberField(raw, fieldLabel, errors, options = {}) {
  const { min = 0 } = options;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors.push(`${fieldLabel} must be a valid number.`);
    return undefined;
  }

  if (parsed < min) {
    errors.push(`${fieldLabel} must be ${min} or greater.`);
    return undefined;
  }

  return parsed;
}

function parseJsonArray(raw, fieldLabel, normalizer, errors) {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return [];

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    errors.push(`${fieldLabel} must be valid JSON.`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    errors.push(`${fieldLabel} must be a JSON array.`);
    return [];
  }

  const normalized = [];
  parsed.forEach((item, index) => {
    const entry = normalizer(item, index, errors);
    if (entry) normalized.push(entry);
  });
  return normalized;
}

function normalizeIngredient(item, index, errors) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`Ingredients entry ${index + 1} must be an object.`);
    return null;
  }

  const ingredientLabel = String(item.ingredient_label || '').trim();
  if (!ingredientLabel) {
    errors.push(`Ingredients entry ${index + 1} requires "ingredient_label".`);
    return null;
  }

  const output = { ingredient_label: ingredientLabel };
  const amount = parseNumberField(
    item.amount === undefined ? '' : String(item.amount),
    `Ingredients entry ${index + 1} amount`,
    errors
  );
  const amountUnit = String(item.amount_unit || '').trim();
  const amountInGram = parseNumberField(
    item.amount_in_gram === undefined ? '' : String(item.amount_in_gram),
    `Ingredients entry ${index + 1} amount_in_gram`,
    errors
  );

  if (Number.isFinite(amount)) {
    output.amount = amount;
  }
  if (amountUnit) {
    output.amount_unit = amountUnit;
  }
  if (Number.isFinite(amountInGram) && amountUnit.toLowerCase() !== 'gram') {
    output.amount_in_gram = amountInGram;
  }

  return output;
}

function normalizeNutrition(item, index, errors) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`Nutrition entry ${index + 1} must be an object.`);
    return null;
  }

  const label = String(item.label || '').trim();
  const amount = String(item.amount || '').trim().toLowerCase();
  if (!label) {
    errors.push(`Nutrition entry ${index + 1} requires "label".`);
    return null;
  }
  if (!NUTRITION_LEVELS.includes(amount)) {
    errors.push(`Nutrition entry ${index + 1} amount must be one of: high, medium, low.`);
    return null;
  }

  return { label, amount };
}

function normalizeTextDetail(item, index, errors, labelPrefix) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${labelPrefix} entry ${index + 1} must be an object.`);
    return null;
  }

  const label = String(item.label || '').trim() || `${labelPrefix} ${index + 1}`;
  const details = String(item.details || '').trim();
  if (!details) {
    errors.push(`${labelPrefix} entry ${index + 1} requires "details".`);
    return null;
  }

  return { label, details };
}

function sortByKey(list, key, direction) {
  const multiplier = direction === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    const aValue = a[key] || '';
    const bValue = b[key] || '';
    return String(aValue).localeCompare(String(bValue)) * multiplier;
  });
}

function sortByNumber(list, key, direction) {
  const multiplier = direction === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    const aValue = Number.isFinite(a[key]) ? a[key] : null;
    const bValue = Number.isFinite(b[key]) ? b[key] : null;
    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return 1;
    if (bValue === null) return -1;
    return (aValue - bValue) * multiplier;
  });
}

function sortRecipes(recipes, sortKey) {
  const list = [...recipes];
  switch (sortKey) {
    case 'updated_asc':
      return list.sort((a, b) => new Date(a.updatedDate || 0) - new Date(b.updatedDate || 0));
    case 'title_asc':
      return sortByKey(list, 'title', 'asc');
    case 'title_desc':
      return sortByKey(list, 'title', 'desc');
    case 'calories_asc':
      return sortByNumber(list, 'calories', 'asc');
    case 'calories_desc':
      return sortByNumber(list, 'calories', 'desc');
    case 'cooking_time_asc':
      return sortByNumber(list, 'cooking_time', 'asc');
    case 'cooking_time_desc':
      return sortByNumber(list, 'cooking_time', 'desc');
    case 'updated_desc':
    default:
      return list.sort((a, b) => new Date(b.updatedDate || 0) - new Date(a.updatedDate || 0));
  }
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCurrentFilters(query) {
  const inputSort = typeof query.sort === 'string' ? query.sort : DEFAULT_SORT;
  const sortValues = SORT_OPTIONS.map((option) => option.value);
  const sort = sortValues.includes(inputSort) ? inputSort : DEFAULT_SORT;

  return {
    q: typeof query.q === 'string' ? query.q.trim() : '',
    foodCategory: typeof query.foodCategory === 'string' ? query.foodCategory.trim() : '',
    cookingCategory: typeof query.cookingCategory === 'string' ? query.cookingCategory.trim() : '',
    tag: typeof query.tag === 'string' ? query.tag.trim() : '',
    sort,
  };
}

function hasActiveFilters(filters) {
  return Boolean(filters.q || filters.foodCategory || filters.cookingCategory || filters.tag || filters.sort !== DEFAULT_SORT);
}

function filterRecipes(recipes, filters) {
  const titleRegex = filters.q ? new RegExp(escapeRegExp(filters.q), 'i') : null;
  return recipes.filter((recipe) => {
    if (filters.foodCategory && recipe.food_category !== filters.foodCategory) {
      return false;
    }
    if (filters.cookingCategory && recipe.cooking_category !== filters.cookingCategory) {
      return false;
    }
    if (filters.tag && !toArray(recipe.tags).includes(filters.tag)) {
      return false;
    }

    if (!titleRegex) {
      return true;
    }

    const searchable = [
      recipe.title,
      recipe.food_category,
      recipe.cooking_category,
      toArray(recipe.tags).join(' '),
    ].join('\n');
    return titleRegex.test(searchable);
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function toJsonText(value) {
  return JSON.stringify(toArray(value), null, 2);
}

function buildEmptyFormState() {
  return {
    title: '',
    originConversationId: '',
    originType: 'chat4',
    originKnowledgeId: '',
    tagsText: '',
    imagesText: '',
    food_category: '',
    cooking_category: '',
    cooking_time: '',
    portions: '',
    calories: '',
    ingredientsJson: '[]',
    nutritionJson: '[]',
    instructionsJson: '[]',
    suggestionsJson: '[]',
  };
}

function buildFormStateFromKnowledge(knowledge) {
  const base = buildEmptyFormState();
  if (!knowledge) return base;

  return {
    ...base,
    title: knowledge.title || '',
    originConversationId: knowledge.originConversationId || '',
    originType: knowledge.originType || 'chat4',
    originKnowledgeId: knowledge._id ? knowledge._id.toString() : '',
    tagsText: toArray(knowledge.tags).join(', '),
    imagesText: toArray(knowledge.images).join(', '),
  };
}

function buildFormStateFromRecipe(recipe) {
  return {
    title: recipe.title || '',
    originConversationId: recipe.originConversationId || '',
    originType: recipe.originType || 'chat4',
    originKnowledgeId: recipe.originKnowledgeId || '',
    tagsText: toArray(recipe.tags).join(', '),
    imagesText: toArray(recipe.images).join(', '),
    food_category: recipe.food_category || '',
    cooking_category: recipe.cooking_category || '',
    cooking_time: toNumberInput(recipe.cooking_time),
    portions: toNumberInput(recipe.portions),
    calories: toNumberInput(recipe.calories),
    ingredientsJson: toJsonText(recipe.ingredients),
    nutritionJson: toJsonText(recipe.nutrition),
    instructionsJson: toJsonText(recipe.instructions),
    suggestionsJson: toJsonText(recipe.suggestions),
  };
}

function buildFormStateFromBody(body) {
  return {
    title: body.title || '',
    originConversationId: body.originConversationId || '',
    originType: body.originType || 'chat4',
    originKnowledgeId: body.originKnowledgeId || '',
    tagsText: body.tagsText || '',
    imagesText: body.imagesText || '',
    food_category: body.food_category || '',
    cooking_category: body.cooking_category || '',
    cooking_time: body.cooking_time || '',
    portions: body.portions || '',
    calories: body.calories || '',
    ingredientsJson: body.ingredientsJson || '[]',
    nutritionJson: body.nutritionJson || '[]',
    instructionsJson: body.instructionsJson || '[]',
    suggestionsJson: body.suggestionsJson || '[]',
  };
}

function parseRecipePayload(body) {
  const errors = [];
  const payload = {
    title: String(body.title || '').trim(),
    originConversationId: String(body.originConversationId || '').trim(),
    originType: body.originType === 'chat5' ? 'chat5' : 'chat4',
    originKnowledgeId: String(body.originKnowledgeId || '').trim() || null,
    tags: parseCommaSeparated(body.tagsText),
    images: parseCommaSeparated(body.imagesText),
    food_category: String(body.food_category || '').trim(),
    cooking_category: String(body.cooking_category || '').trim(),
    cooking_time: parseNumberField(body.cooking_time, 'Cooking time', errors),
    portions: parseNumberField(body.portions, 'Portions', errors),
    calories: parseNumberField(body.calories, 'Calories', errors),
    ingredients: [],
    nutrition: [],
    instructions: [],
    suggestions: [],
  };

  if (!payload.title) {
    errors.push('Title is required.');
  }

  if (payload.originKnowledgeId && payload.originKnowledgeId.length > 100) {
    errors.push('originKnowledgeId is too long.');
  }

  payload.ingredients = parseJsonArray(body.ingredientsJson, 'Ingredients', normalizeIngredient, errors);
  payload.nutrition = parseJsonArray(body.nutritionJson, 'Nutrition', normalizeNutrition, errors);
  payload.instructions = parseJsonArray(
    body.instructionsJson,
    'Instructions',
    (item, index, parseErrors) => normalizeTextDetail(item, index, parseErrors, 'Instruction'),
    errors
  );
  payload.suggestions = parseJsonArray(
    body.suggestionsJson,
    'Suggestions',
    (item, index, parseErrors) => normalizeTextDetail(item, index, parseErrors, 'Suggestion'),
    errors
  );

  return { errors, payload };
}

function buildSourceKnowledgeView(knowledge) {
  if (!knowledge) return null;
  return {
    _id: knowledge._id.toString(),
    title: knowledge.title,
    category: knowledge.category,
    tags: toArray(knowledge.tags),
    images: toArray(knowledge.images),
    originConversationId: knowledge.originConversationId,
    originType: knowledge.originType || 'chat4',
    updatedDateDisplay: toDisplayDate(knowledge.updatedDate),
    contentHTML: marked.parse(knowledge.contentMarkdown || ''),
    contentMarkdown: knowledge.contentMarkdown || '',
  };
}

async function loadKnowledgeById(userId, knowledgeId) {
  if (!knowledgeId) return null;
  try {
    return await Chat4KnowledgeModel
      .findOne({ _id: knowledgeId, user_id: userId, category: 'Recipe' })
      .lean()
      .exec();
  } catch (error) {
    return null;
  }
}

function getTopLevelRatingRows(ratingObject) {
  return Object.keys(ratingObject)
    .filter((key) => key !== 'comment' && key !== 'variants' && Number.isFinite(ratingObject[key]))
    .map((key) => ({ key, value: ratingObject[key] }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function getVariantRatingRows(ratingObject) {
  const variants = toArray(ratingObject.variants);
  return variants
    .filter((variant) => variant && typeof variant === 'object' && !Array.isArray(variant) && variant.label)
    .map((variant) => {
      const row = {
        label: variant.label,
        comment: typeof variant.comment === 'string' ? variant.comment : '',
        ratings: [],
      };

      Object.keys(variant).forEach((key) => {
        if (key === 'label' || key === 'comment') return;
        if (Number.isFinite(variant[key])) {
          row.ratings.push({ key, value: variant[key] });
        }
      });
      row.ratings.sort((a, b) => a.key.localeCompare(b.key));
      return row;
    });
}

function getExistingRatingLabels(ratingObject) {
  const labels = [];
  Object.keys(ratingObject).forEach((key) => {
    if (key === 'comment' || key === 'variants') return;
    if (Number.isFinite(ratingObject[key])) {
      labels.push(key);
    }
  });
  toArray(ratingObject.variants).forEach((variant) => {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return;
    Object.keys(variant).forEach((key) => {
      if (key === 'label' || key === 'comment') return;
      if (Number.isFinite(variant[key])) {
        labels.push(key);
      }
    });
  });
  return uniqueSorted(labels);
}

function buildViewUrl(recipeId, options = {}) {
  const params = new URLSearchParams();
  if (options.variant) {
    params.set('variant', options.variant);
  }
  if (options.status) {
    params.set('status', options.status);
  }
  if (options.message) {
    params.set('message', options.message);
  }
  const query = params.toString();
  return `/cooking/cookbook/${recipeId}${query ? `?${query}` : ''}#rating`;
}

exports.index = async (req, res) => {
  const userId = req.user.name;
  const filters = getCurrentFilters(req.query);

  try {
    const [allRecipes, legacyKnowledge] = await Promise.all([
      CookbookRecipeModel.find({ user_id: userId }).lean().exec(),
      Chat4KnowledgeModel.find({ user_id: userId, category: 'Recipe' }).sort({ updatedDate: -1 }).lean().exec(),
    ]);

    const availableFoodCategories = uniqueSorted(allRecipes.map((recipe) => recipe.food_category));
    const availableCookingCategories = uniqueSorted(allRecipes.map((recipe) => recipe.cooking_category));
    const availableTags = uniqueSorted(allRecipes.flatMap((recipe) => toArray(recipe.tags)));

    const filteredRecipes = sortRecipes(filterRecipes(allRecipes, filters), filters.sort);

    const transitionedKnowledgeIds = new Set(
      allRecipes
        .map((recipe) => recipe.originKnowledgeId)
        .filter(Boolean)
    );
    const pendingKnowledge = legacyKnowledge.filter(
      (knowledge) => !transitionedKnowledgeIds.has(knowledge._id.toString())
    );

    res.render('cookbook/index', {
      recipes: filteredRecipes,
      sortOptions: SORT_OPTIONS,
      filters,
      hasActiveFilters: hasActiveFilters(filters),
      availableFoodCategories,
      availableCookingCategories,
      availableTags,
      pendingKnowledge,
    });
  } catch (error) {
    logger.error('Failed to load cookbook landing page', {
      category: 'cookbook',
      metadata: { userId, message: error.message },
    });
    res.status(500).render('error_page', { error: 'Unable to load cookbook page right now.' });
  }
};

exports.newForm = async (req, res) => {
  const userId = req.user.name;
  const knowledgeId = typeof req.query.knowledgeId === 'string' ? req.query.knowledgeId.trim() : '';

  try {
    const sourceKnowledge = await loadKnowledgeById(userId, knowledgeId);
    if (knowledgeId && !sourceKnowledge) {
      return res.status(404).render('error_page', { error: `Recipe knowledge [${knowledgeId}] was not found.` });
    }

    const formState = sourceKnowledge ? buildFormStateFromKnowledge(sourceKnowledge) : buildEmptyFormState();
    return res.render('cookbook/form', {
      mode: 'create',
      actionPath: '/cooking/cookbook/new',
      submitLabel: 'Create recipe',
      formState,
      errors: [],
      recipeId: null,
      sourceKnowledge: buildSourceKnowledgeView(sourceKnowledge),
    });
  } catch (error) {
    logger.error('Failed to open cookbook create page', {
      category: 'cookbook',
      metadata: { userId, message: error.message },
    });
    return res.status(500).render('error_page', { error: 'Unable to open cookbook form right now.' });
  }
};

exports.create = async (req, res) => {
  const userId = req.user.name;
  const { errors, payload } = parseRecipePayload(req.body);

  try {
    const sourceKnowledge = await loadKnowledgeById(userId, payload.originKnowledgeId);
    if (payload.originKnowledgeId && !sourceKnowledge) {
      errors.push(`Origin knowledge entry [${payload.originKnowledgeId}] was not found.`);
    }

    if (errors.length > 0) {
      return res.status(400).render('cookbook/form', {
        mode: 'create',
        actionPath: '/cooking/cookbook/new',
        submitLabel: 'Create recipe',
        formState: buildFormStateFromBody(req.body),
        errors,
        recipeId: null,
        sourceKnowledge: buildSourceKnowledgeView(sourceKnowledge),
      });
    }

    const created = await new CookbookRecipeModel({
      ...payload,
      rating: {},
      user_id: userId,
    }).save();

    return res.redirect(`/cooking/cookbook/${created._id.toString()}`);
  } catch (error) {
    logger.error('Failed to create cookbook entry', {
      category: 'cookbook',
      metadata: { userId, message: error.message },
    });
    return res.status(500).render('error_page', { error: 'Unable to create cookbook entry.' });
  }
};

exports.editForm = async (req, res) => {
  const userId = req.user.name;
  const recipeId = req.params.id;

  try {
    const recipe = await CookbookRecipeModel.findOne({ _id: recipeId, user_id: userId }).lean().exec();
    if (!recipe) {
      return res.status(404).render('error_page', { error: `Cookbook entry [${recipeId}] was not found.` });
    }

    const sourceKnowledge = await loadKnowledgeById(userId, recipe.originKnowledgeId);
    return res.render('cookbook/form', {
      mode: 'edit',
      actionPath: `/cooking/cookbook/${recipeId}/edit`,
      submitLabel: 'Save changes',
      formState: buildFormStateFromRecipe(recipe),
      errors: [],
      recipeId,
      sourceKnowledge: buildSourceKnowledgeView(sourceKnowledge),
    });
  } catch (error) {
    logger.error('Failed to open cookbook edit page', {
      category: 'cookbook',
      metadata: { userId, recipeId, message: error.message },
    });
    return res.status(500).render('error_page', { error: 'Unable to load cookbook edit page.' });
  }
};

exports.update = async (req, res) => {
  const userId = req.user.name;
  const recipeId = req.params.id;
  const { errors, payload } = parseRecipePayload(req.body);

  try {
    const recipe = await CookbookRecipeModel.findOne({ _id: recipeId, user_id: userId }).exec();
    if (!recipe) {
      return res.status(404).render('error_page', { error: `Cookbook entry [${recipeId}] was not found.` });
    }

    const sourceKnowledge = await loadKnowledgeById(userId, payload.originKnowledgeId);
    if (payload.originKnowledgeId && !sourceKnowledge) {
      errors.push(`Origin knowledge entry [${payload.originKnowledgeId}] was not found.`);
    }

    if (errors.length > 0) {
      return res.status(400).render('cookbook/form', {
        mode: 'edit',
        actionPath: `/cooking/cookbook/${recipeId}/edit`,
        submitLabel: 'Save changes',
        formState: buildFormStateFromBody(req.body),
        errors,
        recipeId,
        sourceKnowledge: buildSourceKnowledgeView(sourceKnowledge),
      });
    }

    recipe.title = payload.title;
    recipe.originConversationId = payload.originConversationId;
    recipe.originType = payload.originType;
    recipe.originKnowledgeId = payload.originKnowledgeId;
    recipe.tags = payload.tags;
    recipe.images = payload.images;
    recipe.food_category = payload.food_category;
    recipe.cooking_category = payload.cooking_category;
    recipe.cooking_time = payload.cooking_time;
    recipe.portions = payload.portions;
    recipe.calories = payload.calories;
    recipe.ingredients = payload.ingredients;
    recipe.nutrition = payload.nutrition;
    recipe.instructions = payload.instructions;
    recipe.suggestions = payload.suggestions;

    await recipe.save();
    return res.redirect(`/cooking/cookbook/${recipeId}`);
  } catch (error) {
    logger.error('Failed to update cookbook entry', {
      category: 'cookbook',
      metadata: { userId, recipeId, message: error.message },
    });
    return res.status(500).render('error_page', { error: 'Unable to update cookbook entry.' });
  }
};

exports.view = async (req, res) => {
  const userId = req.user.name;
  const recipeId = req.params.id;
  const variantLabel = typeof req.query.variant === 'string' ? req.query.variant.trim() : '';

  try {
    const recipe = await CookbookRecipeModel.findOne({ _id: recipeId, user_id: userId }).lean().exec();
    if (!recipe) {
      return res.status(404).render('error_page', { error: `Cookbook entry [${recipeId}] was not found.` });
    }

    const sourceKnowledge = await loadKnowledgeById(userId, recipe.originKnowledgeId);
    const rating = toObject(recipe.rating);
    const suggestions = toArray(recipe.suggestions).map((item) => ({
      label: item.label,
      details: item.details,
      detailsHTML: marked.parse(item.details || ''),
    }));
    const selectedVariant = suggestions.find((item) => item.label === variantLabel) || null;

    const instructions = toArray(recipe.instructions).map((item) => ({
      label: item.label,
      details: item.details,
      detailsHTML: marked.parse(item.details || ''),
    }));

    const ratingLabelOptions = uniqueSorted([...DEFAULT_RATING_LABELS, ...getExistingRatingLabels(rating)]);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const message = typeof req.query.message === 'string' ? req.query.message : '';

    return res.render('cookbook/view', {
      recipe: {
        ...recipe,
        tags: toArray(recipe.tags),
        images: toArray(recipe.images),
      },
      sourceKnowledge,
      instructions,
      suggestions,
      selectedVariant,
      topLevelRatingRows: getTopLevelRatingRows(rating),
      topLevelComment: typeof rating.comment === 'string' ? rating.comment : '',
      variantRatingRows: getVariantRatingRows(rating),
      ratingLabelOptions,
      selectedVariantLabel: selectedVariant ? selectedVariant.label : '',
      status,
      statusMessage: message,
    });
  } catch (error) {
    logger.error('Failed to open cookbook recipe page', {
      category: 'cookbook',
      metadata: { userId, recipeId, message: error.message },
    });
    return res.status(500).render('error_page', { error: 'Unable to load cookbook entry.' });
  }
};

exports.updateRating = async (req, res) => {
  const userId = req.user.name;
  const recipeId = req.params.id;
  const variantLabel = String(req.body.variant_label || '').trim();
  const rawLabel = String(req.body.rating_label || '').trim();
  const customLabel = String(req.body.rating_label_custom || '').trim();
  const ratingLabel = rawLabel === '__custom__' ? customLabel : rawLabel;
  const comment = String(req.body.rating_comment || '').trim();
  const ratingValueRaw = String(req.body.rating_value || '').trim();
  const ratingValue = ratingValueRaw ? Number(ratingValueRaw) : null;

  try {
    const recipe = await CookbookRecipeModel.findOne({ _id: recipeId, user_id: userId }).exec();
    if (!recipe) {
      return res.status(404).render('error_page', { error: `Cookbook entry [${recipeId}] was not found.` });
    }

    const errors = [];
    if (!ratingLabel && !comment) {
      errors.push('Please provide either a rating value or a comment.');
    }
    if (ratingLabel && !Number.isFinite(ratingValue)) {
      errors.push('A numeric rating value is required when a rating label is selected.');
    }
    if (Number.isFinite(ratingValue) && (ratingValue < 0 || ratingValue > 5)) {
      errors.push('Rating value must be between 0 and 5.');
    }
    if (variantLabel) {
      const hasVariant = toArray(recipe.suggestions).some((item) => item.label === variantLabel);
      if (!hasVariant) {
        errors.push(`Variant [${variantLabel}] does not exist for this recipe.`);
      }
    }

    if (errors.length > 0) {
      return res.redirect(buildViewUrl(recipeId, {
        variant: variantLabel,
        status: 'error',
        message: errors.join(' '),
      }));
    }

    const rating = toObject(recipe.rating);
    let target = rating;
    if (variantLabel) {
      const variants = toArray(rating.variants);
      let variantEntry = variants.find((item) => item && item.label === variantLabel);
      if (!variantEntry) {
        variantEntry = { label: variantLabel };
        variants.push(variantEntry);
      }
      rating.variants = variants;
      target = variantEntry;
    }

    if (ratingLabel && Number.isFinite(ratingValue)) {
      target[ratingLabel] = ratingValue;
    }
    if (comment) {
      target.comment = comment;
    }

    recipe.rating = rating;
    recipe.markModified('rating');
    await recipe.save();

    return res.redirect(buildViewUrl(recipeId, {
      variant: variantLabel,
      status: 'saved',
    }));
  } catch (error) {
    logger.error('Failed to update cookbook rating', {
      category: 'cookbook',
      metadata: { userId, recipeId, message: error.message },
    });
    return res.status(500).render('error_page', { error: 'Unable to update recipe rating.' });
  }
};
