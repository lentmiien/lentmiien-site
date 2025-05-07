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

/* ───────────────── API ───────────────── */

//   /budget/api/summary?category=Food
exports.summary = async (req,res)=>{
  const cat = req.query.category || null;
  const rows = await BudgetService.getCategoryMonthlyTotals(cat);
  res.json(rows);
};

//   /budget/api/breakdown/Food/2023/7
exports.breakdown = async (req,res)=>{
  const {cat,y,m} = req.params;
  const info = await BudgetService.getCategoryBreakdown(cat,parseInt(y),parseInt(m));
  res.json(info);
};

//   /budget/api/business?term=se
exports.businessList = async (req,res)=>{
  const list = await BudgetService.searchBusiness(req.query.term || '');
  res.json(list);
};

//   /budget/api/business/values?name=Seven-Eleven
exports.businessDefaults = async (req,res)=>{
  const obj = await BudgetService.businessLastValues(req.query.name || '');
  res.json(obj);
};

exports.newTransaction = async (req,res)=>{
  const t = await BudgetService.insertTransaction(req.body);
  res.status(201).json(t);
};
