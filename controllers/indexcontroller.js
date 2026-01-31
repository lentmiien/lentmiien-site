const { LogModel, SummaryModel, AggregatedDataModel, DetailedDataModel, Dht22AggregatedData, Dht22DetailedData, ExchangeRate } = require('../database');
const logger = require('../utils/logger');
const { diffJSON } = require('../utils/diffJSON');

const DEFAULT_EXCHANGE_BASE = 'JPY';
const DEFAULT_EXCHANGE_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CHF',
  'CAD',
  'AUD',
  'SEK',
  'CNY',
  'NZD',
  'SGD',
  'HKD',
  'KRW',
];
const DEFAULT_EXCHANGE_RANGE_DAYS = 90;
const isValidDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const shiftDateKey = (dateKey, deltaDays) => {
  if (!isValidDateKey(dateKey)) return null;
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
};

const resolveExchangeRange = async (query) => {
  const base = typeof query.base === 'string' ? query.base.trim().toUpperCase() : DEFAULT_EXCHANGE_BASE;
  const baseCode = /^[A-Z]{3}$/.test(base) ? base : DEFAULT_EXCHANGE_BASE;
  const latestEntry = await ExchangeRate.findOne({ base: baseCode }).sort({ date: -1 }).lean();
  const todayKey = new Date().toISOString().slice(0, 10);
  const fallbackEnd = latestEntry?.date || todayKey;
  const requestedEnd = isValidDateKey(query.end) ? query.end : fallbackEnd;
  const requestedStart = isValidDateKey(query.start)
    ? query.start
    : shiftDateKey(requestedEnd, -DEFAULT_EXCHANGE_RANGE_DAYS + 1);
  const start = requestedStart && requestedStart <= requestedEnd ? requestedStart : shiftDateKey(requestedEnd, -DEFAULT_EXCHANGE_RANGE_DAYS + 1);
  const end = requestedEnd;
  return { base: baseCode, start, end };
};

exports.index = (req, res) => {
  res.render('index');
};

exports.login = (req, res) => {
  res.render('login');
};

/****************************/
// EXCHANGE RATES DASHBOARD //
/****************************/
exports.exchange_rates = async (req, res) => {
  try {
    const range = await resolveExchangeRange(req.query || {});
    res.render('exchange_rates', {
      exchangeRatesConfig: {
        base: range.base,
        start: range.start,
        end: range.end,
        defaultCurrencies: DEFAULT_EXCHANGE_CURRENCIES,
      },
    });
  } catch (error) {
    logger.error('Failed to load exchange rate dashboard', { category: 'exchange_rates', metadata: { error: error.message } });
    res.render('exchange_rates', {
      exchangeRatesConfig: {
        base: DEFAULT_EXCHANGE_BASE,
        start: new Date().toISOString().slice(0, 10),
        end: new Date().toISOString().slice(0, 10),
        defaultCurrencies: DEFAULT_EXCHANGE_CURRENCIES,
      },
      errorMessage: 'Unable to load exchange rate dashboard right now.',
    });
  }
};

exports.exchange_rates_data = async (req, res) => {
  try {
    const range = await resolveExchangeRange(req.query || {});
    const entries = await ExchangeRate.find({
      base: range.base,
      date: { $gte: range.start, $lte: range.end },
    })
      .sort({ date: 1 })
      .lean();

    const currenciesSet = new Set();
    entries.forEach((entry) => {
      if (entry && entry.rates) {
        const rateKeys = entry.rates instanceof Map ? Array.from(entry.rates.keys()) : Object.keys(entry.rates);
        rateKeys.forEach((code) => currenciesSet.add(code));
      }
    });

    const primaryList = DEFAULT_EXCHANGE_CURRENCIES.filter((code) => currenciesSet.has(code));
    const extraList = Array.from(currenciesSet).filter((code) => !DEFAULT_EXCHANGE_CURRENCIES.includes(code)).sort();
    const currencies = primaryList.concat(extraList);

    res.json({
      status: 'ok',
      base: range.base,
      start: range.start,
      end: range.end,
      currencies: currencies.length ? currencies : DEFAULT_EXCHANGE_CURRENCIES,
      entries: entries.map((entry) => {
        const rates = entry.rates instanceof Map ? Object.fromEntries(entry.rates) : (entry.rates || {});
        return {
          date: entry.date,
          amount: entry.amount,
          rates,
        };
      }),
    });
  } catch (error) {
    logger.error('Failed to load exchange rate data', { category: 'exchange_rates', metadata: { error: error.message } });
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
const archiver = require('archiver');
exports.download_test = async (req, res) => {
  try {
    // Create a ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Set the compression level
    });

    // Set the response headers
    res.attachment(`files_${Date.now()}.zip`);

    // Pipe the archive to the response
    archive.pipe(res);

    // Append string to file
    archive.append((new Date()).toString(), { name: 'current_date_time.txt' });

    // Append files to the archive
    archive.directory("./public/js", false);

    // Finalize the archive
    await archive.finalize();
  } catch (err) {
    logger.error('Error occurred:', err);
    res.sendStatus(500);
  }
};

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.scroll_test = (req, res) => {
  res.render('scroll_test')
};

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.electricity_usage = async (req, res) => {
  const log = await LogModel.find();
  const summary = await SummaryModel.find();
  res.render('electricity_usage', {log, summary});
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.mpu6050 = async (req, res) => {
  const aggregated_data = await AggregatedDataModel.find();
  const detailed_data = await DetailedDataModel.find();
  res.render('mpu6050', {aggregated_data, detailed_data});
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.dht22 = async (req, res) => {
  const aggregated_data = await Dht22AggregatedData.find();
  const detailed_data = await Dht22DetailedData.find();
  res.render('dht22', {aggregated_data, detailed_data});
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.test_editor = (req, res) => {
  res.render("test_editor");
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.api_test = (req, res) => {
  res.json({
    message: "Hello and welcome to Lennart's website!",
    url: "https://my.lentmiien.com/"
  });
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.img_select = (req, res) => {
  res.render("img_select");
}

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
exports.diff = async (req, res) => {
  let a = { user: { name: 'Alice', age: 29 }, items: [ { id: 1, price: 9.99 }, 2 ] };
  let b = { user: { name: 'Alice B', age: 29 }, items: [ { id: 1, price: 12.99 }, 2, 3 ] };

  if (req.body && req.body.a && req.body.b) {
    a = JSON.parse(req.body.a);
    b = JSON.parse(req.body.b);
  }

  const diff = diffJSON(a, b, { onTypeMismatch: 'record' }); // or 'expand'
  res.render('diff', { title: 'JSON Diff', diff, sideALabel: 'Left (A)', sideBLabel: 'Right (B)' });
}
