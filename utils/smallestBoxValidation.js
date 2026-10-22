const { z } = require('zod');
const dimension = z.number().positive().max(1000000);
const weight = z.number().min(0).max(1000000);
const id = z.string().trim().min(1).max(100);
const containerSchema = z.object({ id, w: dimension, d: dimension, h: dimension,
  emptyWeight: weight, maxLoadWeight: weight }).strict();
const itemSchema = z.object({ id, w: dimension, d: dimension, h: dimension,
  weight, qty: z.number().int().min(1).max(200) }).strict();
const uniqueIds = entries => new Set(entries.map(entry => entry.id)).size === entries.length;
const catalogSchema = z.object({ containers: z.array(containerSchema).max(30).refine(uniqueIds, 'Box IDs must be unique.') }).strict();
const searchSchema = z.object({ algorithm: z.enum(['laff', 'plain', 'bruteforce']).default('laff'),
  items: z.array(itemSchema).min(1).max(100).refine(uniqueIds, 'Item IDs must be unique.') }).strict()
  .refine(value => value.items.reduce((sum, item) => sum + item.qty, 0) <= (value.algorithm === 'bruteforce' ? 7 : 200),
    'Use at most 200 items, or 7 for bruteforce.');
module.exports = { catalogSchema, searchSchema };
