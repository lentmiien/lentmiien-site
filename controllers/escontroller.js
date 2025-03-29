// Require necessary database models
const { ESCategory, ESItem } = require('../database');

exports.es_dashboard = async (req, res) => {
  try {
    const d = new Date()
    const _30_days_ago = new Date(d.getFullYear(), d.getMonth(), d.getDate()-30);
    await ESItem.deleteMany({ rotateDate: { $lt: _30_days_ago } });

    const categories = await ESCategory.find({});
    const items = await ESItem.find({});
    const category_lookup_and_stock = {};
    // Setup data structure
    categories.forEach(c => {
      category_lookup_and_stock[c._id.toString()] = {
        label: c.name,
        stock: 0,
        unit: c.unit,
        percent: 0,
      };
    });
    const old_items = items.filter(i => i.rotateDate < d);
    const stock_items = items.filter(i => i.rotateDate >= d);
    // Add item stock
    stock_items.forEach(i => {
      if (i.categoryId in category_lookup_and_stock) {
        category_lookup_and_stock[i.categoryId].stock += i.amount;
      } else {
        console.log('--- Untracked item ---');
        console.log(i);
      }
    });
    // Calculate percentages
    let total = 0;
    categories.forEach(c => {
      const percent = Math.round(100 * category_lookup_and_stock[c._id.toString()].stock / c.recommendedStock);
      category_lookup_and_stock[c._id.toString()].percent = percent;
      total += percent > 100 ? 100 : percent;
    });
    const average = Math.round(10 * total / categories.length) / 10;
    res.render('es_dashboard', { categories, items: old_items, category_lookup_and_stock, average });
  } catch (err) {
    res.status(500).send('Server Error');
  }
}

exports.es_view_stock = async (req, res) => {
  try {
    const categories = await ESCategory.find({});
    const items = await ESItem.find({});
    const category_lookup_and_stock = {};
    // Setup data structure
    categories.forEach(c => {
      category_lookup_and_stock[c._id.toString()] = {
        label: c.name,
        stock: 0,
        unit: c.unit,
        percent: 0,
        items: [],
      };
    });
    const d = new Date();
    const stock_items = items.filter(i => i.rotateDate >= d);
    // Add item stock
    stock_items.forEach(i => {
      if (i.categoryId in category_lookup_and_stock) {
        category_lookup_and_stock[i.categoryId].stock += i.amount;
        category_lookup_and_stock[i.categoryId].items.push(i);
      } else {
        console.log('--- Untracked item ---');
        console.log(i);
      }
    });
    // Calculate percentages
    let total = 0;
    categories.forEach(c => {
      const percent = Math.round(100 * category_lookup_and_stock[c._id.toString()].stock / c.recommendedStock);
      category_lookup_and_stock[c._id.toString()].percent = percent;
      total += percent > 100 ? 100 : percent;
    });
    const average = Math.round(10 * total / categories.length) / 10;
    res.render('es_view_stock', { categories, category_lookup_and_stock, average });
  } catch (err) {
    res.status(500).send('Server Error');
  }
}

exports.edit_category = async (req, res) => {
  try {
    const { category_id, name, recommendedStock, unit, rotationPeriodMonths } = req.body;

    // Validate input
    if (!name || !recommendedStock || !unit || !rotationPeriodMonths) {
      return res.status(400).send('All fields are required');
    }

    // Convert numeric inputs to appropriate types
    const stock = Number(recommendedStock);
    const rotationPeriod = Number(rotationPeriodMonths);

    // Additional validation
    if (isNaN(stock) || isNaN(rotationPeriod) || stock <= 0 || rotationPeriod <= 0) {
      return res.status(400).send('Invalid numeric values');
    }

    let category;
    if (category_id && category_id.length > 0) {
      // Update existing category
      category = await ESCategory.findByIdAndUpdate(
        category_id,
        { name, recommendedStock: stock, unit, rotationPeriodMonths: rotationPeriod },
        { new: true, runValidators: true }
      );

      if (!category) {
        return res.status(404).send('Category not found');
      }
    } else {
      // Create new category
      category = new ESCategory({
        name,
        recommendedStock: stock,
        unit,
        rotationPeriodMonths: rotationPeriod
      });
      await category.save();
    }

    res.redirect('/es/es_dashboard');
  } catch (err) {
    console.error('Error in edit_category:', err);
    if (err.name === 'ValidationError') {
      res.status(400).send(`Validation Error: ${err.message}`);
    } else {
      res.status(500).send('Server Error');
    }
  }
};

exports.add_item = async (req, res) => {
  try {
    const { add_category_id, amount, rotateDate, label } = req.body;

    // Validate input
    if (!add_category_id || !amount || !rotateDate) {
      return res.status(400).send('Category ID, amount, and rotate date are required');
    }

    // Convert amount to number
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).send('Invalid amount');
    }

    // Validate and adjust the rotate date
    const dateObj = new Date(rotateDate);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).send('Invalid date');
    }
    const adjustedRotateDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);

    // Check if the category exists
    const category = await ESCategory.findById(add_category_id);
    if (!category) {
      return res.status(404).send('Category not found');
    }

    // Create new item
    const newItem = new ESItem({
      categoryId: add_category_id,
      amount: numAmount,
      rotateDate: adjustedRotateDate,
      label: label || undefined // Only add label if it's provided
    });

    // Save to database
    await newItem.save();

    res.redirect('/es/es_dashboard');
  } catch (err) {
    console.error('Error in add_item:', err);
    if (err.name === 'ValidationError') {
      res.status(400).send(`Validation Error: ${err.message}`);
    } else {
      res.status(500).send('Server Error');
    }
  }
};
