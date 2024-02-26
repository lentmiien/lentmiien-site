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
  } else if (method === 'fit_smallest') {
    return fit_smallest(items, boxes);
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

let bestSolution;
/**
 * Search for smallest box than can fit all items,
 * takes into account the shape and position of the items
 * *This is a brute force algorithm, and is meant for testing testing the limitations of a brute force approach, as well as generating data for development of more advance algorithms in the future*
 * If 2 solutions, using the same box, are found, then return the solution that are more compact (the bounding box containing all the items with smallest volume)
 * @param {Array} items // { id, width, height, depth, weight, flags }
 * @param {Array} boxes // { id, width, height, depth, box_weight } *Margin adjusted
 * @returns // Packing list or 'null' if no solution could be found
 */
function fit_smallest(items, boxes) {
  // Go through the items in all possible orders
  // Try to add the the items one-by-one in all possible rotations, aligning the item so that 1 corner aligns with corner of previously placed item, or origin (0, 0, 0) if there is no placed items
  // Check that the newly placed item doesn't overlap with any other items, or overlap negative space, in which case the particular placement should be rejected
  // Once all items has been placed, calculate the bounding box of all the items, then check for a box that fits the item bounding box
  // If the newly found solution is better than the previous solution, then replace the current solution
  // Continue to test all other solutions
  // Return the best solution

  // Set to 'null', indicating that no solution has been found
  bestSolution = null;
  const start_ts = Date.now();

  // Generate all possible rotations
  const items_with_rotations = [];
  items.forEach(item => items_with_rotations.push(getRotations(item)));

  // Generate all possible permutations
  const sort_array = getAllPermutations(items_with_rotations);

  // Generate solution
  sort_array.forEach(perm => placeItems(perm, [], boxes, [{x:0,y:0,z:0}]))

  // End timer
  const total_time_in_seconds = Math.round((Date.now() - start_ts) / 1000);
  if(bestSolution) {
    console.log(`Found solution for ${items.length} items in ${total_time_in_seconds} seconds.`);
  } else {
    console.log(`No solution found, processed ${items.length} items in ${total_time_in_seconds} seconds.`);
  }

  return ("solution" in bestSolution ? bestSolution.solution : null);
}

// Helper to generate list of all possible input permutations
function getAllPermutations(array) {
  const result = [];

  const permute = (arr, m = []) => {
      if (arr.length === 0) {
          result.push(m);
      } else {
          for (let i = 0; i < arr.length; i++) {
              let curr = arr.slice();
              let next = curr.splice(i, 1);
              permute(curr.slice(), m.concat(next));
          }
      }
  };

  permute(array);

  return result;
}

// Helper to generate all rotations of an item
function getRotations(item) {
  return [
    {id: item.id, width: item.width, height: item.height, depth: item.depth, weight: item.weight},
    {id: item.id, width: item.width, height: item.depth, depth: item.height, weight: item.weight},
    {id: item.id, width: item.height, height: item.width, depth: item.depth, weight: item.weight},
    {id: item.id, width: item.height, height: item.depth, depth: item.width, weight: item.weight},
    {id: item.id, width: item.depth, height: item.width, depth: item.height, weight: item.weight},
    {id: item.id, width: item.depth, height: item.height, depth: item.width, weight: item.weight},
  ];
}

// Helper to check for overlap
function checkOverlap(item, placedItems) {
  // // if item not within box, return true
  // if (item.x_pos < 0 || item.y_pos < 0 || item.z_pos < 0) return true;

  for (let b of placedItems) {
    // Check for overlap with cube `b`
    // Check for separation along the X axis
    if (!(item.x_pos + item.x_size <= b.x_pos || b.x_pos + b.x_size <= item.x_pos)) {
      // Check for separation along the Y axis
      if (!(item.y_pos + item.y_size <= b.y_pos || b.y_pos + b.y_size <= item.y_pos)) {
        // Check for separation along the Z axis
        if (!(item.z_pos + item.z_size <= b.z_pos || b.z_pos + b.z_size <= item.z_pos)) {
          // If we reach here, it means the cube `a` overlaps with the current cube `b` along all three axes
          return true; // Cube `a` overlaps with at least one cube in the array
        }
      }
    }
  }

  // If we reach here, it means cube `a` does not overlap with any cube in the array
  return false;
}

// Recursive function to attempt to place items
function placeItems(itemsToPlace, placedItems, boxes, corners) {
  if (itemsToPlace.length === 0) {
    // All items placed, evalute this solution, and update best solution if better than previous solution
    // 1. calculate bounding box for items
    // 2. find smallest box that fits the items (bounding box)
    // 3. check if the found box is smaller than the previous best solution
    // 4. if same box, check if the items are packed more compact, than previous solution
    // 5. if either smaller box or more compact, update best solution
    let bb_x = 0;
    let bb_y = 0;
    let bb_z = 0;
    placedItems.forEach(d => {
      if (d.x_pos + d.x_size > bb_x) bb_x = d.x_pos + d.x_size;
      if (d.y_pos + d.y_size > bb_y) bb_y = d.y_pos + d.y_size;
      if (d.z_pos + d.z_size > bb_z) bb_z = d.z_pos + d.z_size;
    });

    let smallest_box_volume = 999999999999;
    let smallest_box_i = -1;
    boxes.forEach((d, i) => {
      if (d.width >= bb_x && d.height >= bb_y && d.depth >= bb_z && d.width * d.height * d.depth < smallest_box_volume) {
        smallest_box_volume = d.width * d.height * d.depth;
        smallest_box_i = i;
      }
    });

    if (smallest_box_i >= 0) {
      if (bestSolution) {
        // Compare to previous candidate
        if ((bestSolution.box_volume > smallest_box_volume) || (bestSolution.box_volume === smallest_box_volume && bestSolution.item_volume > bb_x * bb_y * bb_z)) {
          // bestSolution // meta data
          bestSolution.box_volume = smallest_box_volume;
          bestSolution.item_volume = bb_x * bb_y * bb_z;
          
          // bestSolution.solution // packing solution
          bestSolution.solution = [];
          bestSolution.solution.push({
            id: boxes[smallest_box_i].id,
            box_weight: boxes[smallest_box_i].box_weight,
            items_in_box: [...placedItems]
          });

          console.log("New best solution: ", bestSolution);
        }
      } else {
        // First candidate (just set the solution)
        bestSolution = {
          box_volume: smallest_box_volume,
          item_volume: bb_x * bb_y * bb_z,
          solution: []
        };
        bestSolution.solution.push({
          id: boxes[smallest_box_i].id,
          box_weight: boxes[smallest_box_i].box_weight,
          items_in_box: [...placedItems]
        });

        console.log("Current best solution: ", bestSolution);
      }
    }

    return; // Return means done
  }

  // Place next item
  // 1. extract next item from list
  // 2. try adding the item in each rotation, and for each corner to align with an existing packed corner
  // 3. once item has been placed, confirm that there is no overlap, and proceed to next item
  // 4. when return, repeat from step 2 until all configurations has been checked

  const item = itemsToPlace[0];
  const remainingItems = itemsToPlace.filter((it, i) => i > 0);
  item.forEach(rotation => {
    corners.forEach(corner => {
      const place_items = [
        { id: rotation.id, x_pos: corner.x, y_pos: corner.y, z_pos: corner.z, x_size: rotation.width, y_size: rotation.height, z_size: rotation.depth, weight: rotation.weight },
        { id: rotation.id, x_pos: corner.x, y_pos: corner.y, z_pos: corner.z-rotation.depth, x_size: rotation.width, y_size: rotation.height, z_size: rotation.depth, weight: rotation.weight },
        { id: rotation.id, x_pos: corner.x-rotation.width, y_pos: corner.y, z_pos: corner.z-rotation.depth, x_size: rotation.width, y_size: rotation.height, z_size: rotation.depth, weight: rotation.weight },
        { id: rotation.id, x_pos: corner.x-rotation.width, y_pos: corner.y, z_pos: corner.z, x_size: rotation.width, y_size: rotation.height, z_size: rotation.depth, weight: rotation.weight },
        { id: rotation.id, x_pos: corner.x, y_pos: corner.y-rotation.height, z_pos: corner.z, x_size: rotation.width, y_size: rotation.height, z_size: rotation.depth, weight: rotation.weight },
        { id: rotation.id, x_pos: corner.x, y_pos: corner.y-rotation.height, z_pos: corner.z-rotation.depth, x_size: rotation.width, y_size: rotation.height, z_size: rotation.depth, weight: rotation.weight },
        { id: rotation.id, x_pos: corner.x-rotation.width, y_pos: corner.y-rotation.height, z_pos: corner.z-rotation.depth, x_size: rotation.width, y_size: rotation.height, z_size: rotation.depth, weight: rotation.weight },
        { id: rotation.id, x_pos: corner.x-rotation.width, y_pos: corner.y-rotation.height, z_pos: corner.z, x_size: rotation.width, y_size: rotation.height, z_size: rotation.depth, weight: rotation.weight },
      ];
      place_items.forEach(place_item => {
        if (place_item.x_pos >= 0 && place_item.y_pos >= 0 && place_item.z_pos >= 0 && checkOverlap(place_item, placedItems) === false) {
          const new_placedItems = [...placedItems, place_item];
          const new_corners = [
            ...corners,
            {x:place_item.x_pos, y:place_item.y_pos, z:place_item.z_pos},
            {x:place_item.x_pos, y:place_item.y_pos, z:place_item.z_pos+rotation.depth},
            {x:place_item.x_pos+rotation.width, y:place_item.y_pos, z:place_item.z_pos+rotation.depth},
            {x:place_item.x_pos+rotation.width, y:place_item.y_pos, z:place_item.z_pos},
            {x:place_item.x_pos, y:place_item.y_pos+rotation.height, z:place_item.z_pos},
            {x:place_item.x_pos, y:place_item.y_pos+rotation.height, z:place_item.z_pos+rotation.depth},
            {x:place_item.x_pos+rotation.width, y:place_item.y_pos+rotation.height, z:place_item.z_pos+rotation.depth},
            {x:place_item.x_pos+rotation.width, y:place_item.y_pos+rotation.height, z:place_item.z_pos}
          ];
          placeItems(remainingItems, new_placedItems, boxes, new_corners);
        }
      });
    });
  });

  return; // Return means done
}
