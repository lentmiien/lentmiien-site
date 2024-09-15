const {
  AccountModel,
  TransactionModel,
  TypecategoryModel,
  TypetagModel,
  AccountDBModel,
  CategoryDBModel,
  TransactionDBModel,
} = require('../database');

exports.index = async (req, res) => {
  // Get database data
  const old_transactions = await TransactionModel.find({},{},{ sort: { transaction_date: -1 } });
  const new_transactions = await TransactionDBModel.find({},{},{ sort: { date: -1 } });
  const old_accounts = await AccountModel.find();
  const new_accounts = await AccountDBModel.find();
  const old_categories = await TypecategoryModel.find();
  const new_categories = await CategoryDBModel.find();
  const old_tags = await TypetagModel.find();

  // Generate lookup tables
  const account_lookup = {};
  const account_index_lookup = [];
  old_accounts.forEach(a => account_lookup[a._id] = a.account_name);
  new_accounts.forEach(a => {
    account_lookup[a._id] = a.name;
    account_index_lookup.push(a._id.toString());
  });
  const category_lookup = {};
  old_categories.forEach(a => category_lookup[a._id] = a.category_name);
  new_categories.forEach(a => category_lookup[a._id] = a.title);
  const tag_lookup = {};
  old_tags.forEach(a => tag_lookup[a._id] = a.tag_name);

  // Generate dashboard data
  const dashboard = {
    accounts: [],
    categories: {},
    budgets: {},
    type_budgets: {
      income: {year_lookup:[],data:[]},
      expense: {year_lookup:[],data:[]},
      saving: {year_lookup:[],data:[]}
    },
    weekly_change_data: []
  };

  // List of accounts with current balance
  new_accounts.forEach(a => {
    dashboard.accounts.push({
      name: a.name,
      balance: a.balance,
      balance_date: a.balance_date,
      currency: a.currency,
    });
  });

  // List of categories
  new_categories.forEach(a => dashboard.categories[a._id.toString()] = {title:a.title,type:a.type});

  // Setup budgets
  new_categories.forEach(c => {
    dashboard.budgets[c._id.toString()] = {year_lookup:[],data:[]};
  });

  // Setup weekly_change_data
  const w = new Date(Date.now() - (1000*60*60*24*7*53));
  const w_ms = (new Date(w.getFullYear(), w.getMonth(), w.getDate()-w.getDay(), 0, 0, 0, 0)).getTime();
  for (let i = 0; i < 52; i++) {
    const start = w_ms + i * (1000*60*60*24*7);
    const end = w_ms + (i+1) * (1000*60*60*24*7) - 1;
    dashboard.weekly_change_data.push({
      start,
      end,
      income: 0,
      expense: 0
    });
  }
  

  const cmap = {
    "5dba210e4d8ddc0017981372": "63a0825d4796a649f99264c8",
    "5dba21204d8ddc0017981373": "63a082ef4796a649f99264d2",
    "5dba21434d8ddc0017981374": "63a082114796a649f99264c2",
    "5dba21684d8ddc0017981375": "63a082754796a649f99264ca",
    "5dba21834d8ddc0017981376": "63a083024796a649f99264d4",
    "5dba21954d8ddc0017981377": "63a0825d4796a649f99264c8",
    "5dba21b54d8ddc0017981378": "63a0825d4796a649f99264c8",
    "5dbe3903fea6a800179ed945": "63a083194796a649f99264d6",
    "5dc2bbd363ffe500176ed555": "63a0833e4796a649f99264da",
    "5f51d7fb8b54560017a0a3d7": "63a083194796a649f99264d6",
    "6136fd4879cadb001797530a": "63a082e04796a649f99264d0",
    "615925ef73feb6001703856b": "63a083194796a649f99264d6"
  };
  // old_transactions -> type_budgets (above 0 JPY income, below 0 JPY expense)
  old_transactions.forEach(t => {
    const year = t.transaction_date.getFullYear();
    const month = t.transaction_date.getMonth() + 1;
    const amount = t.amount >= 0 ? t.amount : -t.amount;
    const category = cmap[t.category_id];
    {
      const year_index = dashboard.budgets[category].year_lookup.indexOf(year);
      if (year_index >= 0) {
        const month_index = dashboard.budgets[category].data[year_index].month_lookup.indexOf(month);
        if (month_index >= 0) {
          // Add to existing entry
          dashboard.budgets[category].data[year_index].data[month_index].amount += amount;
        } else {
          // Add new month to existing year
          dashboard.budgets[category].data[year_index].month_lookup.push(month);
          dashboard.budgets[category].data[year_index].data.push({
            month,
            amount: amount
          });
        }
      } else {
        // Add new year and month
        dashboard.budgets[category].year_lookup.push(year);
        dashboard.budgets[category].data.push({
          year,
          month_lookup: [month],
          data: [{
            month,
            amount: amount
          }]
        });
      }
    }
    let type = t.amount >= 0 ? "income" : "expense";
    if (t.tag_id === "5dc2bbe963ffe500176ed556") type = "saving";// Put transfer amount in saving
    const year_index = dashboard.type_budgets[type].year_lookup.indexOf(year);
    if (year_index >= 0) {
      const month_index = dashboard.type_budgets[type].data[year_index].month_lookup.indexOf(month);
      if (month_index >= 0) {
        // Add to existing entry
        dashboard.type_budgets[type].data[year_index].data[month_index].amount += t.amount >= 0 ? t.amount : -t.amount;
      } else {
        // Add new month to existing year
        dashboard.type_budgets[type].data[year_index].month_lookup.push(month);
        dashboard.type_budgets[type].data[year_index].data.push({
          month,
          amount: t.amount >= 0 ? t.amount : -t.amount
        });
      }
    } else {
      // Add new year and month
      dashboard.type_budgets[type].year_lookup.push(year);
      dashboard.type_budgets[type].data.push({
        year,
        month_lookup: [month],
        data: [{
          month,
          amount: t.amount >= 0 ? t.amount : -t.amount
        }]
      });
    }

    // Weekly
    for (let i = 0; i < 52; i++) {
      if (t.transaction_date.getTime() >= dashboard.weekly_change_data[i].start && t.transaction_date.getTime() <= dashboard.weekly_change_data[i].end) {
        // Ignore tag '5dc2bbe963ffe500176ed556': 'Transfer Amount',
        if (t.tag_id !== '5dc2bbe963ffe500176ed556') {
          if (t.amount >= 0) dashboard.weekly_change_data[i].income += t.amount;
          if (t.amount < 0) dashboard.weekly_change_data[i].expense += t.amount;
        }
      }
    }
  });

  // Process transactions
  new_transactions.forEach(t => {
    // Update account balance
    const fai = account_index_lookup.indexOf(t.from_account);
    if (fai >= 0) {
      if (dashboard.accounts[fai].balance_date < t.date) {
        dashboard.accounts[fai].balance -= t.amount + t.from_fee;
      }
    }
    const tai = account_index_lookup.indexOf(t.to_account);
    if (tai >= 0) {
      if (dashboard.accounts[tai].balance_date < t.date) {
        dashboard.accounts[tai].balance += t.amount - t.to_fee;
      }
    }

    // budgets, type_budgets
    const year = Math.floor(t.date / 10000);
    const month = Math.floor(t.date / 100) % 100;
    let total_amount = 0;
    const category = [];
    t.categories.split('|').forEach(cat => {
      const parts = cat.split("@");
      const val = Math.floor(parseInt(parts[1]) * t.amount / 100);
      category.push({
        c: parts[0],
        amount: val
      });
      total_amount += val;
    });
    if (total_amount < t.amount) category[0].amount += t.amount - total_amount;
    const type = t.type;
    category.forEach(ca => {
      const year_index = dashboard.budgets[ca.c].year_lookup.indexOf(year);
      if (year_index >= 0) {
        const month_index = dashboard.budgets[ca.c].data[year_index].month_lookup.indexOf(month);
        if (month_index >= 0) {
          // Add to existing entry
          dashboard.budgets[ca.c].data[year_index].data[month_index].amount += ca.amount;
        } else {
          // Add new month to existing year
          dashboard.budgets[ca.c].data[year_index].month_lookup.push(month);
          dashboard.budgets[ca.c].data[year_index].data.push({
            month,
            amount: ca.amount
          });
        }
      } else {
        // Add new year and month
        dashboard.budgets[ca.c].year_lookup.push(year);
        dashboard.budgets[ca.c].data.push({
          year,
          month_lookup: [month],
          data: [{
            month,
            amount: ca.amount
          }]
        });
      }
    });
    const year_index = dashboard.type_budgets[type].year_lookup.indexOf(year);
    if (year_index >= 0) {
      const month_index = dashboard.type_budgets[type].data[year_index].month_lookup.indexOf(month);
      if (month_index >= 0) {
        // Add to existing entry
        dashboard.type_budgets[type].data[year_index].data[month_index].amount += t.amount;
      } else {
        // Add new month to existing year
        dashboard.type_budgets[type].data[year_index].month_lookup.push(month);
        dashboard.type_budgets[type].data[year_index].data.push({
          month,
          amount: t.amount
        });
      }
    } else {
      // Add new year and month
      dashboard.type_budgets[type].year_lookup.push(year);
      dashboard.type_budgets[type].data.push({
        year,
        month_lookup: [month],
        data: [{
          month,
          amount: t.amount
        }]
      });
    }
    // Do something similar with transaction_business and tags
    /*
  from_account: { type: String, required: true }, // Account id of payer
  to_account: { type: String, required: true }, // Account id of receiver
  from_fee: { type: Number, required: true }, // Transaction fee for payer
  to_fee: { type: Number, required: true }, // Transaction fee for receiver
  amount: { type: Number, required: true }, // Transaction amount
  date: { type: Number, required: true }, // Date as an integer (ex 20221207 -> December 7th 2022)
  transaction_business: { type: String, required: true }, // Business for external transaction
  type: { type: String, required: true }, // Type of transaction
  categories: { type: String, required: true }, // Categories
  tags: { type: String, required: true }, // Tags
    */
    
    // Weekly
    for (let i = 0; i < 52; i++) {
      const transaction_date = new Date(Math.floor(t.date/10000), Math.floor(t.date/100)%100, t.date%100);
      if (transaction_date.getTime() >= dashboard.weekly_change_data[i].start && transaction_date.getTime() <= dashboard.weekly_change_data[i].end) {
        if (t.type === "income") {
          dashboard.weekly_change_data[i].income += t.amount;
        } else if (t.type === "expense") {
          dashboard.weekly_change_data[i].expense -= t.amount;
        }
        if (t.from_account !== "EXT") {
          dashboard.weekly_change_data[i].expense -= t.from_fee;
        }
        if (t.to_account !== "EXT") {
          dashboard.weekly_change_data[i].expense -= t.to_fee;
        }
      }
    }
  });

  // Render output
  res.render('accounting', {dashboard});
};

exports.add_transaction = async (req, res) => {
  // Get database data
  const new_transactions = await TransactionDBModel.find();
  const new_accounts = await AccountDBModel.find();
  const new_categories = await CategoryDBModel.find();

  // Generate lookup tables
  const account_lookup = {EXT:"Other"};
  const account_index_lookup = [];
  const accounts = [];
  for (let i = 0; i < new_accounts.length; i++) {
    account_lookup[new_accounts[i]._id] = new_accounts[i].name;
    account_index_lookup.push(new_accounts[i]._id.toString());
    accounts.push({
      _id: new_accounts[i]._id.toString(),
      name: new_accounts[i].name,
      balance: new_accounts[i].balance,
      balance_date: new_accounts[i].balance_date,
      currency: new_accounts[i].currency,
      current: new_accounts[i].balance,
    });
  }
  const category_lookup = {};
  new_categories.forEach(a => category_lookup[a._id] = a.title);
  const category_lookup_rev = {};
  new_categories.forEach(a => category_lookup_rev[a.title] = {id:a._id,type:a.type});

  // Calculate current account balance
  new_transactions.forEach(t => {
    const index_f = account_index_lookup.indexOf(t.from_account);
    const index_t = account_index_lookup.indexOf(t.to_account);
    if (index_f >= 0) {
      if (t.date > accounts[index_f].balance_date) {
        accounts[index_f].current -= t.amount + t.from_fee;
      }
    }
    if (index_t >= 0) {
      if (t.date > accounts[index_t].balance_date) {
        accounts[index_t].current += t.amount - t.to_fee;
      }
    }
  });

  // Generate tags list
  const tags = [];

  // Generate business list
  const businesses = [];

  // Create a network structure, linking together values used together, to assist with input process
  const input_network = { all: {} };

  // Generate data from transactions
  const keys = [
    "from_account",
    "to_account",
    "from_fee",
    "to_fee",
    "amount",
    "transaction_business",
    "type",
    "categories",
    "tags"
  ];
  // Network - input_network setup
  keys.forEach(key => {
    input_network[key] = {};
    input_network.all[key] = [];
    input_network.all[`${key}_lookup`] = [];
  });
  new_transactions.forEach(tr => {
    // Get data
    const tdata = {};
    keys.forEach(key => {
      if (key === "categories") {
        tdata[key] = tr[key].split('|').map(a => a.split("@")[0]);
      } else if (key === "tags") {
        tdata[key] = tr[key].split("|");
      } else {
        tdata[key] = [tr[key]];
      }
    });

    // Tag list
    tdata.tags.forEach(tag => {
      if (tags.indexOf(tag) === -1) {
        tags.push(tag);
      }
    });

    // Business list
    if (businesses.indexOf(tr.transaction_business) === -1) {
      businesses.push(tr.transaction_business);
    }

    // Network
    keys.forEach(key => {
      for (let i = 0; i < tdata[key].length; i++) {
        // all
        const all_index = input_network.all[`${key}_lookup`].indexOf(tdata[key][i]);
        if (all_index >= 0) {
          input_network.all[key][all_index].count++;
        } else {
          input_network.all[key].push({value:tdata[key][i],count:1});
          input_network.all[`${key}_lookup`].push(tdata[key][i]);
        }

        // other
        if (!(tdata[key][i] in input_network[key])) {
          input_network[key][tdata[key][i]] = {};
          keys.forEach(skey => input_network[key][tdata[key][i]][skey] = [] );
        }
        keys.forEach(skey => {
          for (let j = 0; j < tdata[key].length; j++) {
            const index = input_network[key][tdata[key][i]][skey].indexOf(tdata[skey][j]);
            if (index === -1) {
              input_network[key][tdata[key][i]][skey].push(tdata[skey][j]);
            }
          }
        });
      }
    });
  });

  // Sort all
  keys.forEach(key => {
    input_network.all[key].sort((a,b) => {
      if (a.count > b.count) return -1;
      if (a.count < b.count) return 1;
      return 0;
    });
  });

  // Sort categories
  const sort_categories = {
    expense: [],
    income: [],
    saving: []
  };
  new_categories.forEach(c => {
    sort_categories[c.type].push(c);
  });

  res.render('add_transaction', {new_accounts: accounts, new_categories, sort_categories, tags, businesses, account_lookup, category_lookup, category_lookup_rev, input_network, pre_set: req.query});
};

exports.add_transaction_post = async (req, res) => {
  // Get database data
  const new_transactions = await TransactionDBModel.find();
  const new_accounts = await AccountDBModel.find();
  const new_categories = await CategoryDBModel.find();

  // Generate lookup tables
  const account_lookup = {EXT:"Other"};
  new_accounts.forEach(a => account_lookup[a._id] = a.name);
  const category_lookup = {};
  new_categories.forEach(a => category_lookup[a._id] = a.title);
  const category_lookup_rev = {};
  new_categories.forEach(a => category_lookup_rev[a.title] = {id:a._id,type:a.type});

  // Generate tags list
  const tags = [];

  // Generate business list
  const businesses = [];

  // Create a network structure, linking together values used together, to assist with input process
  const input_network = { all: {} };

  // Generate data from transactions
  const keys = [
    "from_account",
    "to_account",
    "from_fee",
    "to_fee",
    "amount",
    "transaction_business",
    "type",
    "categories",
    "tags"
  ];
  // Network - input_network setup
  keys.forEach(key => {
    input_network[key] = {};
    input_network.all[key] = [];
    input_network.all[`${key}_lookup`] = [];
  });
  new_transactions.forEach(tr => {
    // Get data
    const tdata = {};
    keys.forEach(key => {
      if (key === "categories") {
        tdata[key] = tr[key].split('|').map(a => a.split("@")[0]);
      } else if (key === "tags") {
        tdata[key] = tr[key].split("|");
      } else {
        tdata[key] = [tr[key]];
      }
    });

    // Tag list
    tdata.tags.forEach(tag => {
      if (tags.indexOf(tag) === -1) {
        tags.push(tag);
      }
    });

    // Business list
    if (businesses.indexOf(tr.transaction_business) === -1) {
      businesses.push(tr.transaction_business);
    }

    // Network
    keys.forEach(key => {
      for (let i = 0; i < tdata[key].length; i++) {
        // all
        const all_index = input_network.all[`${key}_lookup`].indexOf(tdata[key][i]);
        if (all_index >= 0) {
          input_network.all[key][all_index].count++;
        } else {
          input_network.all[key].push({value:tdata[key][i],count:1});
          input_network.all[`${key}_lookup`].push(tdata[key][i]);
        }

        // other
        if (!(tdata[key][i] in input_network[key])) {
          input_network[key][tdata[key][i]] = {};
          keys.forEach(skey => input_network[key][tdata[key][i]][skey] = [] );
        }
        keys.forEach(skey => {
          for (let j = 0; j < tdata[key].length; j++) {
            const index = input_network[key][tdata[key][i]][skey].indexOf(tdata[skey][j]);
            if (index === -1) {
              input_network[key][tdata[key][i]][skey].push(tdata[skey][j]);
            }
          }
        });
      }
    });
  });

  // Sort all
  keys.forEach(key => {
    input_network.all[key].sort((a,b) => {
      if (a.count > b.count) return -1;
      if (a.count < b.count) return 1;
      return 0;
    });
  });

  // Sort categories
  const sort_categories = {
    expense: [],
    income: [],
    saving: []
  };
  new_categories.forEach(c => {
    sort_categories[c.type].push(c);
  });

  // Prepare category value
  const cats = req.body.categories.split('|');
  const cat_arr = [];
  let total = 0;
  cats.forEach(c => {
    const parts = c.split("@");
    const num = parseInt(parts[1]);
    cat_arr.push({
      cat: category_lookup_rev[parts[0]].id,
      num,
      per: 0,
      dec: 0
    });
    total += num;
  });
  let floor_total = 0;
  for (let i = 0; i < cat_arr.length; i++) {
    const floor_val = Math.floor(100 * cat_arr[i].num / total);
    const decimal_val = (100 * cat_arr[i].num / total) - floor_val;
    cat_arr[i].per = floor_val;
    cat_arr[i].dec = decimal_val;
    floor_total += floor_val;
  }
  if (floor_total < 100) {
    cat_arr.sort((a,b) => {
      if (a.dec > b.dec) return -1;
      if (a.dec < b.dec) return 1;
      return 0;
    });
    for (let i = 0; i < cat_arr.length && floor_total < 100; i++) {
      cat_arr[i].per++;
      floor_total++;
    }
  }
  const weighted_categories = [];
  cat_arr.forEach(c => {
    weighted_categories.push(`${c.cat}@${c.per}`);
  });

  // Add to database
  const data = {
    from_account: req.body.from_account,
    to_account: req.body.to_account,
    from_fee: parseInt(req.body.from_fee),
    to_fee: parseInt(req.body.to_fee),
    amount: parseInt(req.body.amount),
    date: parseInt(req.body.date.split("-").join("")),
    transaction_business: req.body.transaction_business,
    type: req.body.type,
    categories: weighted_categories.join('|'),
    tags: req.body.tags
  };
  const add_entry = new TransactionDBModel(data);
  await add_entry.save();
  res.render('add_transaction', {new_accounts, new_categories, sort_categories, tags, businesses, account_lookup, category_lookup, category_lookup_rev, input_network, entry: add_entry});
};

exports.manage_accounts = async (req, res) => {
  const old_accounts = await AccountModel.find();
  const new_accounts = await AccountDBModel.find();
  res.render('manage_accounts', { accounts: new_accounts, old_accounts });
};
exports.manage_accounts_api = async (req, res) => {
  if (req.body.request === "DELETE") {
    await AccountDBModel.deleteOne({_id:req.body.id});
    return res.json({status:`Deleted account ${req.body.id}`});
  } else if (req.body.request === "ADD") {
    // add
    const data = {
      name: req.body.data.name,
      balance: parseInt(req.body.data.balance),
      balance_date: parseInt(req.body.data.balance_date.split('-').join('')),
      currency: req.body.data.currency
    };
    const add_entry = new AccountDBModel(data);
    add_entry.save((err, entry) => {
      return res.json({status:`Added account ${entry._id}`, account: entry});
    });
  } else {
    return res.json({status:`Unknown action`});
  }
};

exports.manage_categories = async (req, res) => {
  const old_categories = await TypecategoryModel.find();
  const new_categories = await CategoryDBModel.find();
  res.render('manage_categories', { categories: new_categories, old_categories });
};
exports.manage_categories_api = async (req, res) => {
  if (req.body.request === "DELETE") {
    await CategoryDBModel.deleteOne({_id:req.body.id});
    return res.json({status:`Deleted category ${req.body.id}`});
  } else if (req.body.request === "ADD") {
    // add
    const data = {
      title: req.body.data.title,
      type: req.body.data.type
    };
    const add_entry = new CategoryDBModel(data);
    add_entry.save((err, entry) => {
      return res.json({status:`Added category ${entry._id}`, category: entry});
    });
  } else {
    return res.json({status:`Unknown action`});
  }
};

// Last 90 days transactions, listed by account
exports.history = async (req, res) => {
  const d = new Date(Date.now() - (1000*60*60*24*90));
  const d_val = d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
  // Get database data
  const old_transactions = await TransactionModel.find({transaction_date: { $gt: d }},{},{ sort: { transaction_date: -1 } });
  const new_transactions = await TransactionDBModel.find({date: { $gt: d_val }},{},{ sort: { date: -1 } });
  const old_accounts = await AccountModel.find();
  const new_accounts = await AccountDBModel.find();
  const old_categories = await TypecategoryModel.find();
  const new_categories = await CategoryDBModel.find();
  const old_tags = await TypetagModel.find();

  // Generate lookup tables
  const account_lookup = {};
  old_accounts.forEach(a => account_lookup[a._id] = a.account_name);
  new_accounts.forEach(a => account_lookup[a._id] = a.name);
  const category_lookup = {};
  old_categories.forEach(a => category_lookup[a._id] = a.category_name);
  new_categories.forEach(a => category_lookup[a._id] = a.title);
  const tag_lookup = {};
  old_tags.forEach(a => tag_lookup[a._id] = a.tag_name);

  // Setup transaction lists for displaying
  const history = {};
  new_transactions.forEach(t => {
    if (t.from_account != "EXT") {
      if (!(account_lookup[t.from_account] in history)) {
        history[account_lookup[t.from_account]] = [];
      }
      history[account_lookup[t.from_account]].push({
        date: t.date,
        amount: -t.amount - t.from_fee,
        total: 0,
        new_tr: true,
        id: t._id.toString()
      });
    }
    if (t.to_account != "EXT") {
      if (!(account_lookup[t.to_account] in history)) {
        history[account_lookup[t.to_account]] = [];
      }
      history[account_lookup[t.to_account]].push({
        date: t.date,
        amount: t.amount - t.to_fee,
        total: 0,
        new_tr: true,
        id: t._id.toString()
      });
    }
  });
  old_transactions.forEach(t => {
    if (!(account_lookup[t.account_id] in history)) {
      history[account_lookup[t.account_id]] = [];
    }
    history[account_lookup[t.account_id]].push({
      date: t.transaction_date.getFullYear()*10000 + (t.transaction_date.getMonth()+1)*100 + t.transaction_date.getDate(),
      amount: t.amount,
      total: 0,
      new_tr: false,
      id: t._id.toString()
    });
  });

  // Sort
  const keys = Object.keys(history);
  keys.forEach(key => {
    history[key].sort((a,b) => {
      if (a.date > b.date) return -1;
      if (a.date < b.date) return 1;
      return 0;
    });
  });

  // Calculate total
  new_accounts.forEach(a => {
    let b_index = -1;
    for (let i = 0; b_index === -1 && i < history[a.name].length-1; i++) {
      if (a.balance_date === history[a.name][i].date) {
        history[a.name][i].total = a.balance;
        b_index = i;
      } else if (a.balance_date < history[a.name][i].date && a.balance_date > history[a.name][i+1].date) {
        history[a.name][i+1].total = a.balance;
        b_index = i+1;
      }
    }
    if (b_index === -1) {
      history[a.name][history[a.name].length - 1].total = a.balance;
      b_index = history[a.name].length - 1;
    }

    // Update older total
    for (let i = b_index + 1; i < history[a.name].length; i++) {
      history[a.name][i].total = history[a.name][i-1].total - history[a.name][i-1].amount;
    }

    // Update newer total
    for (let i = b_index - 1; i >= 0; i--) {
      history[a.name][i].total = history[a.name][i+1].total + history[a.name][i].amount;
    }
  });

  // Render output
  res.render("history", { history, keys });
};

// Delete a transaction
exports.delete = async (req, res) => {
  const id = req.params.id;
  await TransactionDBModel.deleteOne({_id: id});
  res.redirect("/accounting/history");
};

exports.datatest = async (req, res) => {
  const old_transactions = await TransactionModel.find({},{},{ sort: { transaction_date: -1 } });
  const new_transactions = await TransactionDBModel.find({},{},{ sort: { date: -1 } });
  const old_accounts = await AccountModel.find();
  const new_accounts = await AccountDBModel.find();
  const old_categories = await TypecategoryModel.find();
  const new_categories = await CategoryDBModel.find();
  const old_tags = await TypetagModel.find();

  res.render('datatest_budget', { data: {old_transactions, new_transactions, old_accounts, new_accounts, old_categories, new_categories, old_tags} });
};

exports.delete_all = async (req, res) => {
  // await TransactionDBModel.deleteMany();
  // await AccountDBModel.deleteMany();
  // await CategoryDBModel.deleteMany();

  res.redirect('/accounting');
};
