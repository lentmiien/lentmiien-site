// This grants only owner-scoped legacy viewing, behind the existing cooking permission.
const RECIPE_READ = 'cooking.recipe.read';
const ROLE_BUNDLES = {
  admin: [RECIPE_READ],
  family: [RECIPE_READ],
  user: [RECIPE_READ],
};

module.exports = { RECIPE_READ, ROLE_BUNDLES };
