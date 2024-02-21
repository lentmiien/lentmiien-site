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
};