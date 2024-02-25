// Box templates
const boxTemplates = {
  'AA': [256, 181, 45, 100],
  'A': [256, 181, 112, 110],
  'BM': [305, 188, 142, 120],
  'FM': [275, 193, 165, 130],
  'F3': [346, 226, 120, 140],
  'M1.5L': [310, 253, 187, 150],
  '333': [377, 259, 139, 160],
  'B4': [383, 260, 220, 170],
  '999': [335, 281, 228, 180],
  '777': [393, 322, 155, 190],
  '222': [358, 334, 187, 200],
  '888': [568, 220, 75, 210],
  'Tapecho': [800, 148, 113, 220],
  'L2': [430, 317, 296, 230],
  'B1': [533, 375, 153, 240],
  'X1': [606, 421, 174, 250],
  'B3': [544, 364, 287, 260],
  'Tapedai': [750, 432, 167, 270],
  'X2': [597, 421, 347, 280],
  'X3': [719, 440, 380, 290],
  'X5': [741, 593, 381, 300],
  'X4': [1110, 417, 378, 310],
  '81': [1100, 270, 133, 320],
};

// For test purpose only (gives a pre-filled in form)
const sample_data = 'FIGURE-123,2,180,100,65,200,B\nFIGURE-456,1,210,120,80,300,B';

/**
 * GET
 * url: /box
 * Display a page with input form for making a pack request
 */
exports.index = (req, res) => {
  res.render('box', {boxTemplates, boxLabels: Object.keys(boxTemplates), sample_data});
};

/**
 * POST
 * url: /box/pack
 * Takes a pack request and return a box-item configuration that best fit the items
 * 
 * POST body
 * {
 *   items: [{ id, count, width, height, depth, weight, flags }, ...],
 *   boxes: [{ id, width, height, depth, box_weight }, ...],
 *   margin,
 *   method
 * }
 * 
 * Response
 * {
 *   success: true/false,
 *   packed_boxes: [
 *     { id, box_weight, items_in_box: [{ id, x_pos, y_pos, z_pos, x_size, y_size, z_size, weight }, ...] }
 *   ]
 * }
 */
exports.pack = (req, res) => {
  const items = req.body.items;
  const boxes = req.body.boxes;
  const margin = req.body.margin;
  const method = req.body.method;

  // Flatten items (count > 1 -> separate to 1 item per entry)
  const flat_items = [];
  items.forEach(d => {
    for (let i = 0; i < d.count; i++) {
      flat_items.push({
        id: d.id,
        width: d.width,
        height: d.height,
        depth: d.depth,
        weight: d.weight,
        flags: d.flags
      });
    }
  });

  // Calculate margins
  const margin_adjusted_boxes = [];
  boxes.forEach(d => {
    margin_adjusted_boxes.push({
      id: d.id,
      width: d.width - (margin * 2),
      height: d.height - (margin * 2),
      depth: d.depth - (margin * 2),
      box_weight: d.box_weight
    });
  });

  const packedItemsInBoxes = packItems(flat_items, margin_adjusted_boxes, method);

  if (packedItemsInBoxes) {
      res.json({ success: true, packedItemsInBoxes });
  } else {
      res.json({ success: false, message: "Couldn't fit all items into the boxes, or method doesn't exist." });
  }
};

/**
 * Choose the packing algorithm
 * @param {Array} items // { id, width, height, depth, weight, flags }
 * @param {Array} boxes // { id, width, height, depth, box_weight } *Margin adjusted
 * @param {String} method // Name of method to use
 * @returns // Packing list or 'null' if no solution could be found
 */
function packItems(items, boxes, method) {
  // Implement the packing logic here
  if (method === 'fit_fill_rate') {
    return fit_fill_rate(items, boxes);
  } else {
    // Return 'null' if method hasn't been implemented
    return null;
  }
}

/**
 * Search for a box with larger volume than the combined volume of all items,
 * regardless of shape of the items (*disregarding the shape of the items may produce impossible solutions)
 * *This algorithm is only meant for testing purpose*
 * @param {Array} items // { id, width, height, depth, weight, flags }
 * @param {Array} boxes // { id, width, height, depth, box_weight } *Margin adjusted
 * @returns // Packing list or 'null' if no solution could be found
 */
function fit_fill_rate(items, boxes) {
  // Calculate items
  let total_item_volume = 0;
  items.forEach(d => total_item_volume += d.width * d.height * d.depth);

  // Calculate boxes
  let best_box_i = -1;
  let best_box_volume = 999999999999;
  boxes.forEach((d, i) => {
    const box_vol = d.width * d.height * d.depth;
    if (box_vol > total_item_volume && box_vol < best_box_volume) {
      best_box_i = i;
      best_box_volume = box_vol;
    }
  });

  // Return 'null' if no solution were found
  if (best_box_i === -1) return null;

  // Prepare solution
  const solution = [];
  solution.push({
    id: boxes[best_box_i].id,
    box_weight: boxes[best_box_i].box_weight,
    items_in_box: []
  });
  items.forEach(d => {
    solution[0].items_in_box.push({
      id: d.id,
      x_pos: 0,
      y_pos: 0,
      z_pos: 0,
      x_size: d.width,
      y_size: d.height,
      z_size: d.depth,
      weight: d.weight,
    });
  });
  return solution;
}
