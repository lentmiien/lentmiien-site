const BudgetService = require('../services/budgetService');

exports.index = async (req, res) => {
  const data = await BudgetService.getDashboardData();
  res.render('budget_dashboard', {data});
};

exports.delete = async (req, res) => {
  const id = req.params.id;
  await BudgetService.DeleteTransaction(id);
  res.json({deletedId: id});
}