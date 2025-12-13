const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BusinessInfo = z.object({
  name: z.string(),
  address: z.string(),
});
const ReciptDetails = z.object({
  date: z.string(),
  time: z.string(),
  total_amount: z.number(),
  payment_method: z.enum(["credit card", "cash"]),
  business_info: BusinessInfo,
});

const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const KnowledgeService = require('../services/knowledgeService');
const BudgetService = require('../services/budgetService');
const CreditCardService = require('../services/creditCardService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, FileMetaModel, Receipt, ReceiptMappingRule } = require('../database');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);

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

const sanitizeCreditPrefill = (raw = {}) => {
  const multiplier = Number(raw.externalMultiplier);
  return {
    cardId: raw.cardId ? raw.cardId.toString() : '',
    label: raw.label || '',
    external: Boolean(raw.external),
    externalMultiplier: Number.isFinite(multiplier) ? multiplier : 1,
  };
};

const TRUE_LITERALS = new Set(['true', '1', 'yes', 'on', 'y', 't']);
const toBoolean = (value) => {
  if (typeof value === 'string') {
    return TRUE_LITERALS.has(value.trim().toLowerCase());
  }
  return Boolean(value);
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
      creditPrefill: sanitizeCreditPrefill(entry.rule.creditPrefill || {}),
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

exports.receipt = async (req, res) => {
  const start = new Date(Date.now() - (1000*60*60*24*30));
  const receipts = await Receipt.find({date: { $gte: start }}).sort('-date');
  res.render('receipt', {receipts});
};

exports.mapping_rules_page = async (req, res, next) => {
  try {
    const rules = await ReceiptMappingRule.find({}).sort({ priority: -1, updatedAt: -1 });
    res.render('receipt_mappings', { rules });
  } catch (error) {
    if (typeof next === 'function') return next(error);
    return res.status(500).json({ error: error.message });
  }
};

exports.create_mapping_rule = async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new Error('Rule name is required.');
    const target = req.body.target === 'credit' ? 'credit' : 'budget';
    const priority = Number.parseInt(req.body.priority, 10);
    const active = toBoolean(req.body.active);
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const conditions = parseConditionsFromBody(req.body);
    const budgetPrefill = parseBudgetPrefillFromBody(req.body);
    const creditPrefill = parseCreditPrefillFromBody(req.body);

    const rule = new ReceiptMappingRule({
      name,
      description,
      target,
      priority: Number.isFinite(priority) ? priority : 0,
      active,
      conditions,
      budgetPrefill,
      creditPrefill,
    });
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
    const receipt = await Receipt.findById(req.params.id);
    if (!receipt) {
      return res.status(404).render('receipt_entry_result', { ok: false, error: 'Receipt not found.' });
    }

    const [referenceLists = {}, creditCards = [], rules = []] = await Promise.all([
      BudgetService.getReferenceLists(),
      CreditCardService.listCards({ includeStats: false }),
      ReceiptMappingRule.find({}).sort({ priority: -1, updatedAt: -1 }),
    ]);
    const mappingMatches = getMatchingRules(receipt, rules);
    const requestedRuleId = typeof req.query.rule === 'string' ? req.query.rule : null;
    const appliedRule = mappingMatches.find((rule) => rule.id === requestedRuleId) || mappingMatches[0] || null;

    const baseBudgetPrefill = buildBaseBudgetPrefill(receipt, referenceLists.accounts || []);
    const baseCreditPrefill = buildBaseCreditPrefill(receipt);
    const budgetPrefill = appliedRule
      ? mergeBudgetPrefill(baseBudgetPrefill, appliedRule.budgetPrefill)
      : baseBudgetPrefill;
    const creditPrefill = appliedRule
      ? mergeCreditPrefill(baseCreditPrefill, appliedRule.creditPrefill)
      : baseCreditPrefill;

    res.render('receipt_entry', {
      receipt,
      accounts: referenceLists.accounts || [],
      categories: referenceLists.categories || [],
      tags: referenceLists.tags || [],
      types: referenceLists.types || [],
      creditCards: creditCards || [],
      mappingMatches,
      appliedRuleId: appliedRule ? appliedRule.id : null,
      budgetPrefill,
      creditPrefill,
      entryMode: resolveEntryMode(receipt, appliedRule),
    });
  } catch (error) {
    if (typeof next === 'function') {
      return next(error);
    }
    res.status(500).json({ error: error.message });
  }
};

exports.upload_receipt = async (req, res) => {
  // Context and Prompt
  const context = `You are about to use OpenAI's vision model to process receipts, primarily in Japanese. Your task is to accurately extract specific pieces of information from each receipt and present them in a consistent JSON format. The information you need to extract includes:\n\n1. Date of the purchase.\n2. Time of the purchase.\n3. Total purchase amount.\n4. Payment method (e.g., credit card, cash).\n5. Information identifying the business where the purchase was made (e.g., business name, address).\n\nPlease ensure that the output JSON format remains consistent across different receipts.\n\nHere is the JSON template you should use for the output:\n\n{\n  "date": "YYYY-MM-DD",\n  "time": "HH:MM",\n  "total_amount": "X,XXX.XX",\n  "payment_method": "credit card/cash",\n  "business_info": {\n    "name": "Business Name",\n    "address": "Business Address"\n  }\n}`;
  const prompt = `Please extract the following details from the receipt provided:\n1. Date of the purchase.\n2. Time of the purchase.\n3. Total purchase amount.\n4. Payment method (e.g., credit card, cash).\n5. Information identifying the business where the purchase was made (e.g., business name, address).\n\nAssume most receipts will be in Japanese. The output should be structured in the given JSON format.\n\nExample JSON output:\n\n{\n  "date": "YYYY-MM-DD",\n  "time": "HH:MM",\n  "total_amount": "X,XXX.XX",\n  "payment_method": "credit card/cash",\n  "business_info": {\n    "name": "Business Name",\n    "address": "Business Address"\n  }\n}\n\nMake sure to follow this template strictly for consistent results.`;

  const added_array = [];
  const raw_data = [];
  const layoutTexts = normalizeLayoutTexts(req.body.layout_texts, req.files?.length || 0);

  if (!req.files || !req.files.length) {
    if (req.accepts(['html', 'json']) === 'json') {
      return res.status(400).json({ error: 'Please upload at least one receipt image.' });
    }
    return res.status(400).render('receipt', { receipts: added_array, raw_data, error: 'Please upload at least one receipt image.' });
  }

  for (let i = 0; i < req.files.length; i++) {
    const layout_text = (layoutTexts[i] || '').trim();
    const { new_filename, b64_img } = await conversationService.loadProcessNewImageToBase64(req.files[i].destination + req.files[i].filename);
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: context },
        { role: "user", content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${b64_img}`,
              detail: 'high'
            }
          },
          { type: 'text', text: prompt },
          ...(layout_text ? [{ type: 'text', text: `OCR layout text:\n${layout_text}` }] : []),
        ]},
      ],
      response_format: zodResponseFormat(ReciptDetails, "recipt_details"),
    });
    const recipt_details = JSON.parse(response.choices[0].message.content);

    const newReceipt = new Receipt({
      date: new Date(recipt_details.date),
      amount: recipt_details.total_amount,
      method: recipt_details.payment_method,
      business_name: recipt_details.business_info.name,
      business_address: recipt_details.business_info.address,
      layout_text,
      file: new_filename,
    });
    await newReceipt.save();

    raw_data.push({
      date: recipt_details.date,
      time: recipt_details.time,
      total_amount: recipt_details.total_amount,
      payment_method: recipt_details.payment_method,
      business_info: {
        name: recipt_details.business_info.name,
        address: recipt_details.business_info.address,
      },
      layout_text,
    });
    added_array.push(newReceipt);
  }

  if (req.accepts(['html', 'json']) === 'json') {
    return res.json({ receipts: added_array.map(formatReceiptForJson), raw_data });
  }

  res.render('receipt', {receipts: added_array, raw_data });
};

exports.submit_receipt_entry = async (req, res, next) => {
  try {
    const receipt = await Receipt.findById(req.params.id);
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
  const receipt = await Receipt.findById(req.params.id);
  res.render("upload_receipt", {receipt});
}

exports.correct_receipt = async (req, res) => {
  const receipt = await Receipt.findById(req.params.id);

  receipt.date = new Date(req.body.date);
  receipt.amount = parseInt(req.body.amount);
  receipt.method = req.body.method;
  receipt.business_name = req.body.business_name;
  receipt.business_address = req.body.business_address;
  receipt.layout_text = typeof req.body.layout_text === 'string' ? req.body.layout_text : '';
  await receipt.save();

  res.redirect('/receipt');
}

exports.delete_receipt = async (req, res) => {
  await Receipt.findByIdAndDelete(req.params.id);
  res.redirect('/receipt');
}

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
