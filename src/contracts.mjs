import { z } from 'zod';

export class WorkflowError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

export const product = z.object({ sku: z.string().min(1).max(80), name: z.string().min(1).max(200), price_cents: z.number().int().nonnegative() }).strict();
export const searchResult = z.object({ products: z.array(product).max(50), total: z.number().int().nonnegative(), truncated: z.boolean(), currency: z.literal('PEN') }).strict();
export const cartResult = z.object({ items: z.array(product.extend({ quantity: z.number().int().min(1).max(99) })).max(50), subtotal_cents: z.number().int().nonnegative(), currency: z.literal('PEN') }).strict();
export const inputs = {
  search_products: z.object({ query: z.string().trim().max(120), max_results: z.number().int().min(1).max(50).default(20) }).strict(),
  get_cart: z.object({}).strict(),
  add_to_cart: z.object({ sku: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), quantity: z.number().int().min(1).max(99), confirmed: z.literal(true) }).strict(),
};
export const descriptions = {
  search_products: 'Search the local laboratory catalog by name. Prices are integer PEN cents; no real availability claim.',
  get_cart: 'Read the laboratory cart; verify totals and unique SKUs.',
  add_to_cart: 'Add to the laboratory cart, then verify a separate read. Requires confirmed=true after user authorization; never retry automatically.',
};
const route = z.string().regex(/^\/[A-Za-z0-9_/-]+$/).refine(s => !s.includes('//') && !s.includes('..'));
const operation = z.object({ method: z.enum(['GET', 'POST']), path: route }).strict();
export const recipeSchema = z.object({
  version: z.literal(1), source_mode: z.literal('observed_first_party_http'),
  scope: z.literal('controlled_lab_only'), observed_at: z.iso.datetime(),
  operations: z.object({
    search_products: operation.extend({ query_key: z.string().regex(/^[a-z_]+$/), limit_key: z.string().regex(/^[a-z_]+$/) }),
    get_cart: operation,
    add_to_cart: operation.extend({ sku_key: z.string().regex(/^[a-z_]+$/), quantity_key: z.string().regex(/^[a-z_]+$/) }),
  }).strict(),
}).strict().superRefine((r, ctx) => {
  for (const [name, op] of Object.entries(r.operations)) {
    if (op.method !== (name === 'add_to_cart' ? 'POST' : 'GET')) ctx.addIssue({ code: 'custom', message: 'Wrong HTTP effect' });
  }
});

export function parse(schema, value, code = 'INVALID_INPUT') {
  const result = schema.safeParse(value);
  if (!result.success) throw new WorkflowError(code, code === 'INVALID_INPUT' ? 400 : 502);
  return result.data;
}

export function validateCart(value) {
  const cart = parse(cartResult, value, 'UPSTREAM_CHANGED');
  if (new Set(cart.items.map(i => i.sku)).size !== cart.items.length ||
      cart.items.reduce((sum, i) => sum + i.quantity * i.price_cents, 0) !== cart.subtotal_cents) throw new WorkflowError('VERIFICATION_FAILED');
  return cart;
}
