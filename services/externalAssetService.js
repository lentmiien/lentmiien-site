const mongoose = require('mongoose');
const ExternalAsset = require('../models/external_asset');
const ExchangeRate = require('../models/exchange_rate');

const BASE_CURRENCY = 'JPY';
const VALID_KINDS = new Set(['savings', 'loan']);
const VALID_COMPOUNDING = new Set(['none', 'monthly', 'yearly']);
const DEFAULT_INTEREST_SCENARIOS = [
  { key: 'zero', label: '0% no interest', annualRate: 0 },
  { key: 'configured', label: 'Configured rates', annualRate: null },
  { key: 'quarter', label: '0.25%', annualRate: 0.25 },
  { key: 'half', label: '0.50%', annualRate: 0.5 },
  { key: 'one', label: '1.00%', annualRate: 1 },
  { key: 'two', label: '2.00%', annualRate: 2 },
];

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function cleanCurrency(value) {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : BASE_CURRENCY;
  return /^[A-Z]{3}$/.test(currency) ? currency : BASE_CURRENCY;
}

function cleanDate(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveNumber(value, fallback = 0) {
  return Math.max(0, toNumber(value, fallback));
}

function cleanKind(value) {
  return VALID_KINDS.has(value) ? value : 'savings';
}

function cleanCompounding(value) {
  return VALID_COMPOUNDING.has(value) ? value : 'monthly';
}

function serializeAsset(asset) {
  if (!asset) return null;
  const plain = typeof asset.toObject === 'function' ? asset.toObject() : asset;
  const kind = cleanKind(plain.kind);
  const currentBalance = toPositiveNumber(plain.currentBalance);
  return {
    id: plain._id ? plain._id.toString() : null,
    name: plain.name,
    kind,
    currency: cleanCurrency(plain.currency),
    startDate: plain.startDate || '',
    scheduledEndDate: plain.scheduledEndDate || '',
    currentBalance,
    signedBalance: kind === 'loan' ? 0 - currentBalance : currentBalance,
    balanceDate: plain.balanceDate || '',
    monthlyPayment: toPositiveNumber(plain.monthlyPayment),
    annualInterestRate: toNumber(plain.annualInterestRate),
    compounding: cleanCompounding(plain.compounding),
    active: plain.active !== false,
    notes: plain.notes || '',
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
}

function payloadToUpdate(payload = {}) {
  const name = cleanName(payload.name);
  if (!name) {
    throw new Error('External asset name is required');
  }
  return {
    name,
    kind: cleanKind(payload.kind),
    currency: cleanCurrency(payload.currency),
    startDate: cleanDate(payload.startDate),
    scheduledEndDate: cleanDate(payload.scheduledEndDate),
    currentBalance: toPositiveNumber(payload.currentBalance),
    balanceDate: cleanDate(payload.balanceDate) || todayKey(),
    monthlyPayment: toPositiveNumber(payload.monthlyPayment),
    annualInterestRate: toNumber(payload.annualInterestRate),
    compounding: cleanCompounding(payload.compounding),
    active: payload.active !== false && payload.active !== 'false',
    notes: typeof payload.notes === 'string' ? payload.notes.trim() : '',
  };
}

function ratesToObject(rates) {
  if (!rates) return {};
  if (rates instanceof Map) return Object.fromEntries(rates);
  return rates;
}

async function getLatestExchangeRate() {
  const record = await ExchangeRate.findOne({ base: BASE_CURRENCY }).sort({ date: -1 }).lean();
  if (!record) {
    return {
      date: null,
      amount: 1,
      rates: {},
    };
  }
  return {
    date: record.date,
    amount: toPositiveNumber(record.amount, 1) || 1,
    rates: ratesToObject(record.rates),
  };
}

function convertToJpy(amount, currency, exchangeRate) {
  const cleanAmount = toNumber(amount);
  const clean = cleanCurrency(currency);
  if (clean === BASE_CURRENCY) {
    return {
      value: cleanAmount,
      rate: 1,
      date: exchangeRate.date || null,
      available: true,
    };
  }
  const rate = Number(exchangeRate.rates && exchangeRate.rates[clean]);
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      value: null,
      rate: null,
      date: exchangeRate.date || null,
      available: false,
    };
  }
  return {
    value: (cleanAmount / rate) * exchangeRate.amount,
    rate,
    date: exchangeRate.date || null,
    available: true,
  };
}

function addValuation(asset, exchangeRate) {
  const nativeConversion = convertToJpy(asset.currentBalance, asset.currency, exchangeRate);
  const signedConversion = nativeConversion.available
    ? convertToJpy(asset.signedBalance, asset.currency, exchangeRate)
    : nativeConversion;
  return {
    ...asset,
    currentBalanceJpy: nativeConversion.value,
    signedBalanceJpy: signedConversion.value,
    exchangeRate: {
      date: nativeConversion.date,
      rate: nativeConversion.rate,
      available: nativeConversion.available,
    },
  };
}

function monthsUntilEndOfYear(date = new Date()) {
  return Math.max(0, 12 - (date.getUTCMonth() + 1));
}

function monthsUntilAge(age, profile = { birthYear: 1985, birthMonth: 7 }, date = new Date()) {
  const target = new Date(Date.UTC(profile.birthYear + age, profile.birthMonth - 1, 1));
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return Math.max(0, ((target.getUTCFullYear() - current.getUTCFullYear()) * 12) + (target.getUTCMonth() - current.getUTCMonth()));
}

function buildProjectionHorizons(date = new Date()) {
  return [
    { key: 'end_year', label: `End ${date.getUTCFullYear()}`, months: monthsUntilEndOfYear(date) },
    { key: 'end_next_year', label: `End ${date.getUTCFullYear() + 1}`, months: monthsUntilEndOfYear(date) + 12 },
    { key: 'age_50', label: 'Age 50', months: monthsUntilAge(50, undefined, date) },
    { key: 'age_65', label: 'Age 65', months: monthsUntilAge(65, undefined, date) },
  ];
}

function projectAssetNative(asset, months, annualRateOverride) {
  const ratePercent = annualRateOverride === null || annualRateOverride === undefined
    ? toNumber(asset.annualInterestRate)
    : toNumber(annualRateOverride);
  const annualRate = Math.max(-100, ratePercent) / 100;
  const compounding = annualRate === 0 ? 'none' : cleanCompounding(asset.compounding);
  let balance = toPositiveNumber(asset.currentBalance);
  let contributed = balance;
  const monthlyPayment = toPositiveNumber(asset.monthlyPayment);

  for (let index = 1; index <= months; index += 1) {
    if (compounding === 'monthly') {
      balance *= 1 + (annualRate / 12);
    } else if (compounding === 'yearly' && index % 12 === 0) {
      balance *= 1 + annualRate;
    }
    if (asset.kind === 'loan') {
      balance = Math.max(0, balance - monthlyPayment);
    } else {
      balance += monthlyPayment;
      contributed += monthlyPayment;
    }
  }

  if (asset.kind === 'loan') {
    return {
      projectedBalance: balance,
      projectedSignedBalance: 0 - balance,
      contributed: toPositiveNumber(asset.currentBalance),
      interestEarned: 0,
    };
  }

  return {
    projectedBalance: balance,
    projectedSignedBalance: balance,
    contributed,
    interestEarned: balance - contributed,
  };
}

function projectScenario(assets, exchangeRate, scenario, horizons) {
  const savingsAssets = assets.filter((asset) => asset.kind === 'savings');
  const zeroScenario = scenario.key === 'zero';
  const byHorizon = horizons.map((horizon) => {
    let projectedJpy = 0;
    let contributedJpy = 0;
    let interestJpy = 0;
    let unavailableCount = 0;

    savingsAssets.forEach((asset) => {
      const annualRate = zeroScenario ? 0 : scenario.annualRate;
      const projection = projectAssetNative(asset, horizon.months, annualRate);
      const projectedConversion = convertToJpy(projection.projectedBalance, asset.currency, exchangeRate);
      const contributedConversion = convertToJpy(projection.contributed, asset.currency, exchangeRate);
      const interestConversion = convertToJpy(projection.interestEarned, asset.currency, exchangeRate);
      if (!projectedConversion.available || !contributedConversion.available || !interestConversion.available) {
        unavailableCount += 1;
        return;
      }
      projectedJpy += projectedConversion.value;
      contributedJpy += contributedConversion.value;
      interestJpy += interestConversion.value;
    });

    return {
      ...horizon,
      projectedJpy,
      contributedJpy,
      interestJpy,
      unavailableCount,
    };
  });

  return {
    ...scenario,
    horizons: byHorizon,
  };
}

function addScenarioDeltas(scenarios) {
  const zero = scenarios.find((scenario) => scenario.key === 'zero');
  if (!zero) return scenarios;
  return scenarios.map((scenario) => ({
    ...scenario,
    horizons: scenario.horizons.map((horizon) => {
      const base = zero.horizons.find((item) => item.key === horizon.key);
      return {
        ...horizon,
        extraVsZeroJpy: base ? horizon.projectedJpy - base.projectedJpy : 0,
      };
    }),
  }));
}

function buildTotals(assets) {
  return assets.reduce((totals, asset) => {
    const signed = Number(asset.signedBalanceJpy);
    if (!Number.isFinite(signed)) {
      totals.unavailableCount += 1;
      return totals;
    }
    if (asset.kind === 'loan') {
      totals.loanJpy += Math.abs(signed);
    } else {
      totals.savingsJpy += signed;
    }
    totals.netJpy += signed;
    totals.count += 1;
    return totals;
  }, {
    count: 0,
    savingsJpy: 0,
    loanJpy: 0,
    netJpy: 0,
    unavailableCount: 0,
  });
}

async function listAssets(options = {}) {
  const query = {};
  if (options.includeInactive !== true) {
    query.active = true;
  }
  const [rows, exchangeRate] = await Promise.all([
    ExternalAsset.find(query).sort({ kind: 1, name: 1 }).lean(),
    getLatestExchangeRate(),
  ]);
  const assets = rows.map(serializeAsset).map((asset) => addValuation(asset, exchangeRate));
  return {
    assets,
    exchangeRate,
    totals: buildTotals(assets),
  };
}

async function getSummary() {
  const { assets, exchangeRate, totals } = await listAssets();
  const horizons = buildProjectionHorizons();
  const scenarios = addScenarioDeltas(
    DEFAULT_INTEREST_SCENARIOS.map((scenario) => projectScenario(assets, exchangeRate, scenario, horizons)),
  );
  return {
    assets,
    exchangeRate,
    totals,
    interestImpact: {
      horizons,
      scenarios,
    },
  };
}

async function createAsset(payload) {
  const doc = new ExternalAsset(payloadToUpdate(payload));
  const saved = await doc.save();
  const exchangeRate = await getLatestExchangeRate();
  return addValuation(serializeAsset(saved), exchangeRate);
}

async function updateAsset(assetId, payload) {
  if (!mongoose.isValidObjectId(assetId)) {
    throw new Error('Invalid external asset id');
  }
  const doc = await ExternalAsset.findByIdAndUpdate(
    assetId,
    { $set: payloadToUpdate(payload) },
    { new: true, runValidators: true },
  ).lean();
  if (!doc) {
    throw new Error('External asset not found');
  }
  const exchangeRate = await getLatestExchangeRate();
  return addValuation(serializeAsset(doc), exchangeRate);
}

async function deleteAsset(assetId) {
  if (!mongoose.isValidObjectId(assetId)) {
    throw new Error('Invalid external asset id');
  }
  const doc = await ExternalAsset.findByIdAndUpdate(
    assetId,
    { $set: { active: false } },
    { new: true },
  ).lean();
  if (!doc) {
    throw new Error('External asset not found');
  }
  return serializeAsset(doc);
}

async function applyMonthlyPayment(assetId) {
  if (!mongoose.isValidObjectId(assetId)) {
    throw new Error('Invalid external asset id');
  }
  const asset = await ExternalAsset.findById(assetId);
  if (!asset || asset.active === false) {
    throw new Error('External asset not found');
  }
  const monthlyPayment = toPositiveNumber(asset.monthlyPayment);
  if (asset.kind === 'loan') {
    asset.currentBalance = Math.max(0, toPositiveNumber(asset.currentBalance) - monthlyPayment);
  } else {
    asset.currentBalance = toPositiveNumber(asset.currentBalance) + monthlyPayment;
  }
  asset.balanceDate = todayKey();
  const saved = await asset.save();
  const exchangeRate = await getLatestExchangeRate();
  return addValuation(serializeAsset(saved), exchangeRate);
}

module.exports = {
  BASE_CURRENCY,
  buildProjectionHorizons,
  convertToJpy,
  createAsset,
  deleteAsset,
  getLatestExchangeRate,
  getSummary,
  listAssets,
  projectAssetNative,
  updateAsset,
  applyMonthlyPayment,
};
