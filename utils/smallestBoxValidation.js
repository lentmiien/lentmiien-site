const { z } = require('zod');
const dimension = z.number().positive().max(1000000);
const weight = z.number().min(0).max(1000000);
const MAX_CONTAINERS = 50;
const tag = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
const tagsSchema = z.array(tag).max(20).transform(tags => [...new Set(tags)]);
const tagFilterSchema = z.object({ require: tagsSchema.default([]), requireNot: tagsSchema.default([]) }).strict();
const id = z.string().trim().min(1).max(100);
const containerSchema = z.object({ id, w: dimension, d: dimension, h: dimension,
  emptyWeight: weight, maxLoadWeight: weight, tags: tagsSchema.default([]) }).strict();
const itemSchema = z.object({ id, w: dimension, d: dimension, h: dimension,
  weight, qty: z.number().int().min(1).max(200) }).strict();
const uniqueIds = entries => new Set(entries.map(entry => entry.id)).size === entries.length;
const catalogSchema = z.object({ containers: z.array(containerSchema).max(MAX_CONTAINERS).refine(uniqueIds, 'Box IDs must be unique.') }).strict();
const searchSchema = z.object({ algorithm: z.enum(['laff', 'plain', 'bruteforce']).default('laff'),
  tagFilter: tagFilterSchema.optional(),
  items: z.array(itemSchema).min(1).max(100).refine(uniqueIds, 'Item IDs must be unique.') }).strict()
  .refine(value => value.items.reduce((sum, item) => sum + item.qty, 0) <= (value.algorithm === 'bruteforce' ? 7 : 200),
    'Use at most 200 items, or 7 for bruteforce.');
const catalogUpdateSchema = catalogSchema.extend({ revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
module.exports = { MAX_CONTAINERS, catalogSchema, catalogUpdateSchema, searchSchema, tagsSchema };
