const { isObjectIdOrHexString } = require('mongoose');
const logger = require('../utils/logger');
const { readLegacyScan } = require('../services/legacyReceiptScan');
const { parseOptionalDateOnly } = require('../utils/dateOnly');
const { errorDiagnostics } = require('../utils/errorDiagnostics');
const { saveReceiptFile, ReceiptFileError } = require('../services/receiptUploadService');
const BudgetService = require('../services/budgetService');
const CreditCardService = require('../services/creditCardService');
const {
  DEFAULT_HISTORY_VALUE,
  getReceiptHistoryConfig,
  resolveReceiptHistorySelection,
  buildReceiptHistoryReturnUrl,
} = require('../utils/receiptHistory');
const { Receipt, ReceiptMappingRule } = require('../database');

// Existing unowned records belong to the shared legacy ledger. New receipts
// belong to their uploader, including when two operators submit the same scan.
function receiptScope(req) {
  return { $or: [{ ownerId: req.user._id }, { ownerId: null }] };
}

function findReceipt(req) {
  if (!isObjectIdOrHexString(req.params.id)) return null;
  return Receipt.findOne({ _id: req.params.id, ...receiptScope(req) });
}

const normalizeLayoutTexts = (input, count) => {
  if (!count) return [];
  const values = Array.isArray(input) ? input : (input ? [input] : []);
  const normalized = [];
  for (let i = 0; i < count; i++) {
    const rawValue = typeof values[i] === 'string' ? values[i] : '';
    normalized.push(rawValue);
  }
  return normalized;
};

const formatReceiptForJson = (receipt) => {
  const id = receipt && receipt._id ? receipt._id.toString() : '';
  return {
    id,
    date: receipt.date,
    amount: receipt.amount,
    method: receipt.method,
    business_name: receipt.business_name,
    business_address: receipt.business_address,
    layout_text: receipt.layout_text,
    file: receipt.file,
    image_url: id ? `/receipt/scan/${id}` : null,
    view_url: id ? `/receipt/view_receipt/${id}` : null,
  };
};

const sanitizeBudgetPrefill = (raw = {}) => {
  const num = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    from_account: raw.from_account || '',
    to_account: raw.to_account || '',
    from_fee: num(raw.from_fee, 0),
    to_fee: num(raw.to_fee, 0),
    categories: raw.categories || '',
    tags: raw.tags || '',
    type: raw.type || '',
    transaction_business: raw.transaction_business || '',
  };
};

const TRUE_LITERALS = new Set(['true', '1', 'yes', 'on', 'y', 't']);
const toBoolean = (value) => {
  if (typeof value === 'string') {
    return TRUE_LITERALS.has(value.trim().toLowerCase());
  }
  return Boolean(value);
};

const sanitizeCreditPrefill = (raw = {}, fallback = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const legacy = fallback && typeof fallback === 'object' ? fallback : {};
  const pick = (key) => {
    if (source[key] !== undefined && source[key] !== null) return source[key];
    return legacy[key];
  };
  const multiplier = Number(pick('externalMultiplier'));
  return {
    cardId: pick('cardId') ? pick('cardId').toString() : '',
    label: pick('label') || '',
    external: toBoolean(pick('external')),
    externalMultiplier: Number.isFinite(multiplier) ? multiplier : 1,
  };
};

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
};

const isoDateString = (dateInput) => {
  if (!dateInput) return '';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
};

const intDateFromISO = (value) => {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('-');
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map((p) => parseInt(p, 10));
  if (!year || !month || !day) return null;
  return (year * 10000) + (month * 100) + day;
};

const buildReceiptContext = (receipt) => ({
  business_name: receipt.business_name || '',
  business_address: receipt.business_address || '',
  layout_text: receipt.layout_text || '',
  method: receipt.method || '',
  amount: String(receipt.amount || ''),
});

const matchesCondition = (condition, context) => {
  if (!condition || !condition.field) return false;
  const source = String(context[condition.field] || '');
  const value = String(condition.value || '');
  const operator = condition.operator || 'icontains';
  if (!value) return false;
  switch (operator) {
    case 'equals':
      return source.trim().toLowerCase() === value.trim().toLowerCase();
    case 'not_contains':
      return !source.toLowerCase().includes(value.trim().toLowerCase());
    case 'regex':
      try {
        return new RegExp(value, 'i').test(source);
      } catch (err) {
        return false;
      }
    case 'icontains':
    default:
      return source.toLowerCase().includes(value.trim().toLowerCase());
  }
};

const getMatchingRules = (receipt, rules) => {
  const context = buildReceiptContext(receipt);
  const list = Array.isArray(rules) ? rules : [];
  return list
    .filter((rule) => rule && rule.active !== false)
    .map((rule) => {
      const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
      const matched = conditions.every((condition) => matchesCondition(condition, context));
      return { rule, matched, conditions };
    })
    .filter((entry) => entry.matched)
    .map((entry) => ({
      id: entry.rule._id.toString(),
      name: entry.rule.name,
      target: entry.rule.target || 'budget',
      priority: entry.rule.priority || 0,
      description: entry.rule.description || '',
      budgetPrefill: sanitizeBudgetPrefill(entry.rule.budgetPrefill || {}),
      creditPrefill: sanitizeCreditPrefill(entry.rule.creditPrefill || {}, entry.rule),
      conditions: entry.conditions,
      updatedAt: entry.rule.updatedAt || null,
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
};

const guessAccountId = (accounts, method = '') => {
  if (!Array.isArray(accounts) || !accounts.length) return '';
  const methodLower = method.toLowerCase();
  const keywords = methodLower.includes('cash')
    ? ['cash', 'wallet']
    : ['card', 'credit', 'visa', 'master', 'amex'];
  const match = accounts.find((acc) => keywords.some((kw) => (acc.name || '').toLowerCase().includes(kw)));
  return match ? match._id.toString() : '';
};

const buildBaseBudgetPrefill = (receipt, accounts) => ({
  from_account: guessAccountId(accounts, receipt.method),
  to_account: 'EXT',
  from_fee: 0,
  to_fee: 0,
  amount: receipt.amount || '',
  date: isoDateString(receipt.date),
  categories: '',
  tags: '',
  type: 'expense',
  transaction_business: receipt.business_name || '',
});

const buildBaseCreditPrefill = (receipt) => ({
  cardId: '',
  transactionDate: isoDateString(receipt.date),
  label: receipt.business_name || 'Receipt',
  amount: receipt.amount || '',
  external: false,
  externalMultiplier: 1,
});

const mergeBudgetPrefill = (base, override = {}) => {
  const merged = { ...base };
  const sanitized = sanitizeBudgetPrefill(override);
  Object.keys(sanitized).forEach((key) => {
    const value = sanitized[key];
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.trim() === '') return;
    if (typeof value === 'number' && Number.isNaN(value)) return;
    merged[key] = value;
  });
  return merged;
};

const mergeCreditPrefill = (base, override = {}) => {
  const merged = { ...base };
  const sanitized = sanitizeCreditPrefill(override);
  Object.keys(sanitized).forEach((key) => {
    const value = sanitized[key];
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.trim() === '') return;
    if (typeof value === 'number' && Number.isNaN(value)) return;
    merged[key] = value;
  });
  return merged;
};

const resolveEntryMode = (receipt, appliedRule) => {
  if (appliedRule && appliedRule.target) return appliedRule.target;
  const method = typeof receipt.method === 'string' ? receipt.method.toLowerCase() : '';
  return method.includes('credit') ? 'credit' : 'budget';
};

const parseConditionsFromBody = (body) => {
  const fields = ensureArray(body.condition_field);
  const operators = ensureArray(body.condition_operator);
  const values = ensureArray(body.condition_value);
  const conditions = [];
  const max = Math.max(fields.length, operators.length, values.length);
  for (let i = 0; i < max; i += 1) {
    const field = typeof fields[i] === 'string' ? fields[i].trim() : '';
    const operator = typeof operators[i] === 'string' ? operators[i].trim() : 'icontains';
    const value = typeof values[i] === 'string' ? values[i].trim() : '';
    if (!field || !value) continue;
    conditions.push({
      field,
      operator: operator || 'icontains',
      value,
    });
  }
  return conditions;
};

const parseBudgetPrefillFromBody = (body) => sanitizeBudgetPrefill({
  from_account: body.from_account_prefill,
  to_account: body.to_account_prefill,
  from_fee: body.from_fee_prefill,
  to_fee: body.to_fee_prefill,
  categories: body.categories_prefill,
  tags: body.tags_prefill,
  type: body.type_prefill,
  transaction_business: body.transaction_business_prefill,
});

const parseCreditPrefillFromBody = (body) => sanitizeCreditPrefill({
  cardId: body.cardId_prefill,
  label: body.label_prefill,
  external: toBoolean(body.external_prefill),
  externalMultiplier: body.externalMultiplier_prefill,
});

const normalizeCreditPrefillForPersistence = (creditPrefill) => {
  const normalized = sanitizeCreditPrefill(creditPrefill);
  if (!normalized.cardId) delete normalized.cardId;
  return normalized;
};

const parseMappingRuleFromBody = (body) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new Error('Rule name is required.');
  const priority = Number.parseInt(body.priority, 10);
  return {
    name,
    description: typeof body.description === 'string' ? body.description.trim() : '',
    target: body.target === 'credit' ? 'credit' : 'budget',
    priority: Number.isFinite(priority) ? priority : 0,
    active: toBoolean(body.active),
    conditions: parseConditionsFromBody(body),
    budgetPrefill: parseBudgetPrefillFromBody(body),
    creditPrefill: normalizeCreditPrefillForPersistence(parseCreditPrefillFromBody(body)),
  };
};

const serializeMappingRuleForForm = (rule) => {
  if (!rule) return null;
  const plain = typeof rule.toObject === 'function' ? rule.toObject() : rule;
  const id = plain._id && typeof plain._id.toString === 'function' ? plain._id.toString() : String(plain._id || '');
  return {
    ...plain,
    id,
    priority: plain.priority || 0,
    active: plain.active !== false,
    conditions: Array.isArray(plain.conditions) ? plain.conditions : [],
    budgetPrefill: sanitizeBudgetPrefill(plain.budgetPrefill || {}),
    creditPrefill: sanitizeCreditPrefill(plain.creditPrefill || {}, plain),
  };
};

const fetchMappingRules = () => ReceiptMappingRule.find({}).sort({ priority: -1, updatedAt: -1 });

const renderMappingRulesPage = async (res, options = {}) => {
  const rules = await fetchMappingRules();
  res.render('receipt_mappings', {
    rules,
    editRule: serializeMappingRuleForForm(options.editRule),
    errorMessage: options.errorMessage || null,
  });
};

const fetchReceiptHistoryState = async (req) => {
  const historyState = getReceiptHistoryConfig(req.query.history);
  const receipts = await Receipt.find({ ...historyState.query, ...receiptScope(req) }).sort('-date');
  return {
    ...historyState,
    receipts,
  };
};

exports.receipt = async (req, res, next) => {
  try {
    const historyState = await fetchReceiptHistoryState(req);
    res.render('receipt', historyState);
  } catch (error) {
    if (typeof next === 'function') return next(error);
    res.status(500).json({ error: error.message });
  }
};

exports.receipt_history = async (req, res, next) => {
  try {
    const historyState = await fetchReceiptHistoryState(req);
    res.render('receipt_history_partial', historyState);
  } catch (error) {
    if (typeof next === 'function') return next(error);
    res.status(500).send('Unable to load receipt history.');
  }
};

exports.mapping_rules_page = async (req, res, next) => {
  try {
    await renderMappingRulesPage(res);
  } catch (error) {
    if (typeof next === 'function') return next(error);
    return res.status(500).json({ error: error.message });
  }
};

exports.create_mapping_rule = async (req, res, next) => {
  try {
    const rule = new ReceiptMappingRule(parseMappingRuleFromBody(req.body));
    await rule.save();
    res.redirect('/receipt/mappings');
  } catch (error) {
    if (typeof next === 'function') return next(error);
    return res.status(400).json({ error: error.message });
  }
};

exports.edit_mapping_rule_page = async (req, res, next) => {
  try {
    const editRule = await ReceiptMappingRule.findById(req.params.id);
    if (!editRule) {
      res.status(404);
      return renderMappingRulesPage(res, { errorMessage: 'Mapping rule not found.' });
    }
    return renderMappingRulesPage(res, { editRule });
  } catch (error) {
    if (typeof next === 'function') return next(error);
    return res.status(400).json({ error: error.message });
  }
};

exports.update_mapping_rule = async (req, res, next) => {
  try {
    const rule = await ReceiptMappingRule.findById(req.params.id);
    if (!rule) {
      res.status(404);
      return renderMappingRulesPage(res, { errorMessage: 'Mapping rule not found.' });
    }
    Object.assign(rule, parseMappingRuleFromBody(req.body));
    await rule.save();
    res.redirect('/receipt/mappings');
  } catch (error) {
    if (typeof next === 'function') return next(error);
    return res.status(400).json({ error: error.message });
  }
};

exports.update_mapping_rule_priority = async (req, res, next) => {
  try {
    const priority = Number.parseInt(req.body.priority, 10);
    if (!Number.isFinite(priority)) throw new Error('Priority must be a number.');
    const rule = await ReceiptMappingRule.findById(req.params.id);
    if (!rule) {
      res.status(404);
      return renderMappingRulesPage(res, { errorMessage: 'Mapping rule not found.' });
    }
    rule.priority = priority;
    await rule.save();
    res.redirect('/receipt/mappings');
  } catch (error) {
    if (typeof next === 'function') return next(error);
    return res.status(400).json({ error: error.message });
  }
};

exports.delete_mapping_rule = async (req, res, next) => {
  try {
    await ReceiptMappingRule.findByIdAndDelete(req.params.id);
    res.redirect('/receipt/mappings');
  } catch (error) {
    if (typeof next === 'function') return next(error);
    return res.status(400).json({ error: error.message });
  }
};

exports.receipt_entry_form = async (req, res, next) => {
  try {
    const receipt = await findReceipt(req);
    if (!receipt) {
      return res.status(404).render('receipt_entry_result', { ok: false, error: 'Receipt not found.' });
    }

    const [
      referenceLists = {},
      creditCards = [],
      rules = [],
      budgetSuggestions = {},
      creditLabelSuggestions = [],
    ] = await Promise.all([
      BudgetService.getReferenceLists(),
      CreditCardService.listCards({ includeStats: false }),
      ReceiptMappingRule.find({}).sort({ priority: -1, updatedAt: -1 }),
      BudgetService.getReceiptEntrySuggestions({ limit: 300 }),
      CreditCardService.getLabelSuggestions({ limit: 300 }),
    ]);
    const mappingMatches = getMatchingRules(receipt, rules);
    const requestedRuleId = typeof req.query.rule === 'string' ? req.query.rule : null;
    const appliedRule = mappingMatches.find((rule) => rule.id === requestedRuleId) || mappingMatches[0] || null;

    const defaultBudgetPrefill = buildBaseBudgetPrefill(receipt, referenceLists.accounts || []);
    const defaultCreditPrefill = buildBaseCreditPrefill(receipt);
    const defaultEntryMode = resolveEntryMode(receipt, null);
    const budgetPrefill = appliedRule
      ? mergeBudgetPrefill(defaultBudgetPrefill, appliedRule.budgetPrefill)
      : defaultBudgetPrefill;
    const creditPrefill = appliedRule
      ? mergeCreditPrefill(defaultCreditPrefill, appliedRule.creditPrefill)
      : defaultCreditPrefill;

    res.render('receipt_entry', {
      receipt,
      accounts: referenceLists.accounts || [],
      categories: referenceLists.categories || [],
      tags: referenceLists.tags || [],
      types: referenceLists.types || [],
      creditCards: creditCards || [],
      mappingMatches,
      appliedRuleId: appliedRule ? appliedRule.id : null,
      defaultBudgetPrefill,
      defaultCreditPrefill,
      defaultEntryMode,
      budgetPrefill,
      creditPrefill,
      entryMode: resolveEntryMode(receipt, appliedRule),
      receiptAutocomplete: {
        businesses: budgetSuggestions.businesses || [],
        tags: budgetSuggestions.tags || [],
        creditLabels: (creditLabelSuggestions || []).map((entry) => entry.label).filter(Boolean),
      },
    });
  } catch (error) {
    if (typeof next === 'function') {
      return next(error);
    }
    res.status(500).json({ error: error.message });
  }
};

exports.upload_receipt = async (req, res) => {
  const files = req.files || [];
  const receipts = [];
  const raw_data = [];
  const failures = [];
  let status = 200;
  const layoutTexts = normalizeLayoutTexts(req.body.layout_texts, files.length);
  const dateOverride = req.body.purchase_date;
  function respond(statusCode, error) {
    if (req.accepts(['html', 'json']) === 'json') {
      return res.status(statusCode).json({ receipts: receipts.map(formatReceiptForJson), raw_data, failures, error });
    }
    return res.status(statusCode).render('receipt', {
      ...getReceiptHistoryConfig(DEFAULT_HISTORY_VALUE), receipts, raw_data, failures, error,
    });
  }
  if (!files.length) return respond(400, 'Please upload at least one receipt image.');
  if (dateOverride && (typeof dateOverride !== 'string' || files.length !== 1)) {
    return respond(400, 'Upload one file at a time when supplying its purchase date.');
  }
  for (const [index, file] of files.entries()) {
    try {
      const receipt = await saveReceiptFile({
        Receipt, ownerId: req.user._id, file, layoutText: layoutTexts[index].trim(), dateOverride,
      });
      receipts.push(receipt);
      raw_data.push({
        date: receipt.date.toISOString().slice(0, 10), time: receipt.time,
        total_amount: receipt.amount, payment_method: receipt.method, layout_text: receipt.layout_text,
        business_info: { name: receipt.business_name, address: receipt.business_address },
      });
    } catch (cause) {
      const known = cause instanceof ReceiptFileError;
      const field = known ? cause.field : 'storage';
      const kind = known ? cause.kind : 'save_failed';
      if (!known) logger.error('Receipt persistence failed', { category: 'receipt', metadata: errorDiagnostics(cause) });
      else if (cause.status === 422) logger.warning('Receipt file failed validation', { category: 'receipt', metadata: { field, kind } });
      status = Math.max(status, known ? cause.status : 503);
      failures.push({ index, field, kind, message: known ? cause.message : 'Could not confirm the save. Retry this file.' });
    }
  }
  return respond(receipts.length && failures.length ? 207 : status);
};

exports.receipt_scan = async (req, res) => {
  const query = findReceipt(req);
  if (!query) return res.sendStatus(404);
  const receipt = await query.select('file +scanJpeg');
  if (!receipt) return res.sendStatus(404);
  let jpeg = receipt.scanJpeg;
  if (!jpeg && receipt.file) {
    try {
      jpeg = await readLegacyScan(receipt.file);
    } catch (error) {
      logger.warning('Stored legacy receipt scan could not be read', { category: 'receipt', metadata: errorDiagnostics(error) });
    }
  }
  if (!jpeg) return res.sendStatus(404);
  res.set({ 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline; filename="receipt.jpg"', 'X-Content-Type-Options': 'nosniff' });
  return res.send(jpeg);
};

exports.submit_receipt_entry = async (req, res, next) => {
  try {
    const receipt = await findReceipt(req);
    if (!receipt) {
      const message = 'Receipt not found.';
      if (req.accepts(['html', 'json']) === 'json') {
        return res.status(404).json({ ok: false, error: message });
      }
      return res.status(404).render('receipt_entry_result', { ok: false, error: message });
    }

    const entryType = req.body.entryType === 'credit' ? 'credit' : 'budget';
    const payload = entryType === 'credit'
      ? buildCreditPayload(req.body, receipt)
      : buildBudgetPayload(req.body, receipt);

    const result = entryType === 'credit'
      ? await CreditCardService.createTransaction(payload)
      : await BudgetService.insertTransaction(payload);

    if (req.accepts(['html', 'json']) === 'json') {
      return res.json({ ok: true, entryType, result });
    }
    return res.render('receipt_entry_result', { ok: true, entryType, receipt, result });
  } catch (error) {
    if (req.accepts(['html', 'json']) === 'json') {
      return res.status(400).json({ ok: false, error: error.message });
    }
    if (typeof next === 'function') {
      return next(error);
    }
    return res.status(400).render('receipt_entry_result', { ok: false, error: error.message });
  }
};

exports.view_receipt = async (req, res) => {
  const receipt = await findReceipt(req);
  if (!receipt) return res.sendStatus(404);
  const returnHistory = resolveReceiptHistorySelection(req.query.history);
  res.render('upload_receipt', { receipt, returnHistory });
};

exports.correct_receipt = async (req, res) => {
  const receipt = await findReceipt(req);

  if (!receipt) return res.sendStatus(404);
  let date;
  try { date = parseOptionalDateOnly(req.body.date); } catch { /* Invalid calendar date. */ }
  const amount = typeof req.body.amount === 'string' && req.body.amount.trim() ? Number(req.body.amount) : NaN;
  if (!date || !Number.isFinite(amount) || typeof req.body.method !== 'string' || !req.body.method.trim()) {
    return res.status(422).send('Enter a valid purchase date, amount and payment method.');
  }
  receipt.date = date;
  receipt.amount = amount;
  receipt.method = req.body.method;
  receipt.business_name = req.body.business_name;
  receipt.business_address = req.body.business_address;
  receipt.layout_text = typeof req.body.layout_text === 'string' ? req.body.layout_text : '';
  await receipt.save();

  res.redirect(buildReceiptHistoryReturnUrl(req.query.history || req.body.history));
};

exports.delete_receipt = async (req, res) => {
  if (!isObjectIdOrHexString(req.params.id)) return res.sendStatus(404);
  const result = await Receipt.deleteOne({ _id: req.params.id, ...receiptScope(req) });
  if (!result.deletedCount) return res.sendStatus(404);
  res.redirect(buildReceiptHistoryReturnUrl(req.query.history));
};

const buildBudgetPayload = (body, receipt) => {
  const fromAccount = typeof body.from_account === 'string' ? body.from_account.trim() : '';
  const toAccount = typeof body.to_account === 'string' ? body.to_account.trim() : '';
  const dateIso = typeof body.date === 'string' && body.date.trim()
    ? body.date.trim()
    : isoDateString(receipt.date);
  const dateInt = intDateFromISO(dateIso);
  const amount = Number(body.amount !== undefined && body.amount !== null && body.amount !== '' ? body.amount : receipt.amount);
  const fromFee = Number(body.from_fee);
  const toFee = Number(body.to_fee);
  const categories = typeof body.categories === 'string' ? body.categories.trim() : '';
  const transactionBusinessRaw = typeof body.transaction_business === 'string' ? body.transaction_business.trim() : '';
  const transactionBusiness = transactionBusinessRaw || (receipt.business_name || '').trim();
  const type = typeof body.type === 'string' && body.type.trim() ? body.type.trim() : 'expense';
  const tags = typeof body.tags === 'string' ? body.tags.trim() : '';

  if (!fromAccount || !toAccount) throw new Error('Select both payer and receiver accounts.');
  if (!Number.isFinite(amount)) throw new Error('Amount must be a valid number.');
  if (!dateInt) throw new Error('A valid transaction date is required.');
  if (!categories) throw new Error('At least one category is required.');
  if (!transactionBusiness) throw new Error('Business name is required.');

  return {
    from_account: fromAccount,
    to_account: toAccount,
    from_fee: Number.isFinite(fromFee) ? fromFee : 0,
    to_fee: Number.isFinite(toFee) ? toFee : 0,
    amount,
    date: dateInt,
    transaction_business: transactionBusiness,
    type,
    categories,
    tags,
  };
};

const buildCreditPayload = (body, receipt) => {
  const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : '';
  const transactionDate = typeof body.transactionDate === 'string' && body.transactionDate.trim()
    ? body.transactionDate.trim()
    : isoDateString(receipt.date);
  const amount = body.amount !== undefined && body.amount !== null && body.amount !== ''
    ? body.amount
    : receipt.amount;
  const label = typeof body.label === 'string' && body.label.trim()
    ? body.label.trim()
    : (receipt.business_name || 'Receipt');
  const external = toBoolean(body.external);
  const externalMultiplier = Number(body.externalMultiplier);

  if (!cardId) throw new Error('Choose a credit card to record this transaction.');
  if (!transactionDate) throw new Error('Transaction date is required.');
  if (amount === undefined || amount === null || amount === '') throw new Error('Amount is required.');
  if (!label) throw new Error('Label is required.');

  return {
    cardId,
    transactionDate,
    label,
    amount,
    external,
    externalMultiplier: Number.isFinite(externalMultiplier) ? externalMultiplier : 1,
  };
};

function ParseData(text) {
  if (text.indexOf("```") >= 0) {
    // Sometimes, the relevant content comes in a markdown code block
    let data = [];
    let rows = text.split('\n');
    let inJSON = false;
    for (let i = 0; i < rows.length; i++) {
      if (inJSON && rows[i].indexOf("```") >= 0) break;
      if (inJSON) data.push(rows[i]);
      if (rows[i].indexOf("```") >= 0) inJSON = true;
    }
    return JSON.parse(data.join("\n"));
  } else {
    // Other times, only the relevant data comes
    return JSON.parse(text);
  }
}
