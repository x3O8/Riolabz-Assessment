import { z } from 'zod';
import { orderStatuses } from '../domain/order.js';
import { nonEmptyPatch, objectId, paging, trimmed, unsignedInteger } from '../shared/validation.js';

const email = z.string().trim().max(254).pipe(z.email()).transform(value => value.toLowerCase());
const loginPassword = z.string().min(1).max(128);
export const newAccount = z.strictObject({
  name: trimmed(1, 100), email, password: loginPassword.min(8),
});
export const loginBody = z.strictObject({ email, password: loginPassword });
export const userStatusBody = z.strictObject({ active: z.boolean() });
export const usersQuery = z.strictObject({
  ...paging,
  role: z.enum(['admin', 'customer']).optional(),
  active: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
});

export const categoryBody = z.strictObject({ name: trimmed(1, 120), parent: objectId.nullable().optional() });
export const categoryPatch = nonEmptyPatch(categoryBody);

const maximumPrice = 100_000_000;
const price = z.number().int().min(0).max(maximumPrice);
const productStatus = z.enum(['active', 'inactive']);
export const productBody = z.strictObject({
  name: trimmed(1, 160),
  sku: trimmed(1, 64).pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/))
    .transform(value => value.toUpperCase()),
  description: trimmed(0, 5000).optional(),
  price,
  salePrice: price.nullable().optional(),
  stock: z.number().int().min(0).max(1_000_000_000),
  category: objectId,
  status: productStatus.optional(),
});
export const productPatch = nonEmptyPatch(productBody);
const productQuery = z.strictObject({
  ...paging,
  q: trimmed(1, 120).optional(),
  category: objectId.optional(),
  minPrice: unsignedInteger(0, maximumPrice).optional(),
  maxPrice: unsignedInteger(0, maximumPrice).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'name_asc', 'name_desc']).default('newest'),
});
const validPriceRange = ({ minPrice, maxPrice }) => (
  minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice
);
const priceRangeError = { path: ['maxPrice'], message: 'Maximum price must be at least the minimum price' };
export const publicProductsQuery = productQuery.refine(validPriceRange, priceRangeError);
export const adminProductsQuery = productQuery.extend({
  status: productStatus.optional(),
}).refine(validPriceRange, priceRangeError);

const orderStatus = z.enum(orderStatuses);
export const orderBody = z.strictObject({
  items: z.array(z.strictObject({
    productId: objectId, quantity: z.number().int().min(1).max(10_000),
  })).min(1).max(50),
});
export const orderHeaders = z.object({
  'idempotency-key': z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
});
export const orderStatusBody = z.strictObject({ status: orderStatus });
export const ordersQuery = z.strictObject({ ...paging, status: orderStatus.optional() });
export const adminOrdersQuery = ordersQuery.extend({ customer: objectId.optional() });
