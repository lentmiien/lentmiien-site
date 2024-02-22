/**
 * GET
 * url: /box
 * Display a page with input form for making a pack request
 */
exports.index = (req, res) => {
  res.render('box');
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
 *     { id, items: [{ id, x_pos, y_pos, z_pos, x_size, y_size, z_size, weight }, ...] }
 *   ]
 * }
 */
exports.pack = (req, res) => {
  const items = req.body.items;
  const boxes = req.body.boxes;
  const margin = req.body.margin;
  const method = req.body.method;
  const packedItemsInBoxes = packItems(items, boxes, margin, method);

  if (packedItemsInBoxes) {
      res.json({ success: true, packedItemsInBoxes });
  } else {
      res.json({ success: false, message: "Couldn't fit all items into the boxes." });
  }
};

function packItems(items, boxes, margin, method) {
  // Implement the packing logic here
  // Placeholder for the packing logic; convert the DFS approach here
  return [
    {
      id: boxes[0].id,
      items: [
        {
          id: items[0].id,
          x_pos: 0,
          y_pos: 0,
          z_pos: 0,
          x_size: items[0].width,
          y_size: items[0].height,
          z_size: items[0].depth,
          weight: items[0].weight,
        }
      ]
    }
  ]; // Placeholder return (return first box with first item)
}
