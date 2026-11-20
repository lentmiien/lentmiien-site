// Resolve a batch in request order. A saved item can later be merged again.
// Cache shared targets and bound the total database time for long chains.
async function resolveSavedItems(Item, items, projection) {
  const records = new Map(items.map(item => [String(item._id), item]));
  const deadline = Date.now() + 5000;
  let frontier = items;
  while (frontier.length) {
    const missing = new Set();
    for (const item of frontier) {
      if (item.mergedInto && !records.has(String(item.mergedInto))) missing.add(String(item.mergedInto));
    }
    if (!missing.size) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('AmiAmi redirect lookup timed out');
    frontier = await Item.find({ _id: { $in: [...missing] } }, projection).maxTimeMS(remaining).lean().exec();
    if (frontier.length !== missing.size) throw new Error('AmiAmi redirect target missing');
    for (const item of frontier) records.set(String(item._id), item);
  }

  return items.map(item => {
    const seen = new Set();
    while (item.mergedInto) {
      const target = String(item.mergedInto);
      if (seen.has(target)) throw new Error('Circular AmiAmi redirect');
      seen.add(target);
      item = records.get(target);
    }
    return item;
  });
}

module.exports = { resolveSavedItems };
