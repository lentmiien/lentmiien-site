const { z } = require('zod');
const dimension = z.number().min(0.01).max(100000);
const id = z.string().trim().min(1).max(120);
const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
const itemSchema = z.object({
  id, width: dimension, height: dimension, depth: dimension,
  quantity: z.number().int().min(1).max(500).default(1),
  weight: z.number().min(0).max(1e12).default(0),
  // 500 maximum-value items still fit the deliberately non-limiting box value cap.
  value: z.number().min(0).max(2e9).default(0),
  rotation: z.enum(['none', 'orthogonal', 'free']).default('orthogonal'),
  shrink: z.number().min(0).max(95).default(0),
  soft: z.boolean().default(false), fragile: z.boolean().default(false),
}).strict();
const preferredSize = z.number().min(0.01).max(1e12).nullable().default(null);
const preferredLoad = z.number().min(0).max(1e12).nullable().default(null);
const optionsSchema = z.object({
  approach: z.enum(['boxes', 'space']).default('boxes'),
  margin: z.number().min(0).max(10000).default(0),
  maxSide: preferredSize, maxSum: preferredSize, maxWeight: preferredLoad, maxValue: preferredLoad,
}).strict();
const requestSchema = z.object({
  items: z.array(itemSchema).min(1).max(500).refine(unique, 'Item IDs must be unique.'),
  options: optionsSchema.prefault({}),
  boxIds: z.array(id).min(1).max(50).refine(ids => new Set(ids).size === ids.length).optional(),
}).strict().refine(data => data.items.reduce((sum, item) => sum + item.quantity, 0) <= 500,
  'Use at most 500 individual items.');
const jobIdSchema = z.string().uuid();
module.exports = { requestSchema, jobIdSchema };
