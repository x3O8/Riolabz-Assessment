import { Order, Product } from '../models/index.js';
import { transaction } from '../config/database.js';
import { canTransition, fingerprintItems, normalizeItems } from '../domain/order.js';
import { conflict, notFound, paginate } from '../shared/http.js';

function orderView(order) {
  const { idempotencyKey, requestFingerprint, ...view } = order;
  return view;
}

function replay(order, fingerprint) {
  if (order.requestFingerprint !== fingerprint) {
    throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different order');
  }
  return { order: orderView(order), created: false };
}

function findReplay(customer, idempotencyKey) {
  return Order.findOne({ customer, idempotencyKey }).select('+requestFingerprint').lean();
}

async function reserveProduct({ productId, quantity }, session) {
  const available = { _id: productId, deletedAt: null, status: 'active' };
  const product = await Product.findOneAndUpdate(
    { ...available, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
    { session },
  ).lean();

  if (!product) {
    if (await Product.exists(available).session(session)) {
      throw conflict('INSUFFICIENT_STOCK', 'A product has insufficient stock', { productId });
    }
    throw conflict('PRODUCT_UNAVAILABLE', 'A product is unavailable', { productId });
  }

  return {
    productId, quantity, name: product.name, sku: product.sku,
    unitPrice: product.effectivePrice, lineTotal: product.effectivePrice * quantity,
  };
}

export async function placeOrder(customer, inputItems, idempotencyKey) {
  const items = normalizeItems(inputItems);
  const requestFingerprint = idempotencyKey ? fingerprintItems(items) : undefined;
  try {
    return await transaction(async session => {
      if (idempotencyKey) {
        const existing = await findReplay(customer, idempotencyKey).session(session);
        if (existing) return replay(existing, requestFingerprint);
      }

      const lines = [];
      for (const item of items) {
        lines.push(await reserveProduct(item, session));
      }
      const total = lines.reduce((sum, item) => sum + item.lineTotal, 0);
      const [order] = await Order.create([{
        customer, items: lines, total, idempotencyKey, requestFingerprint,
      }], { session });
      return { order: orderView(order.toObject()), created: true };
    });
  } catch (error) {
    // Identical keys may race even when the requests touch different products.
    if (idempotencyKey && error.code === 11000 && error.keyPattern?.idempotencyKey) {
      const existing = await findReplay(customer, idempotencyKey);
      if (existing) return replay(existing, requestFingerprint);
    }
    throw error;
  }
}

export function listOrders({ status, customer, page, limit }) {
  const filter = {};
  if (status !== undefined) filter.status = status;
  if (customer !== undefined) filter.customer = customer;
  return paginate(Order, filter, { page, limit }, { createdAt: -1, _id: -1 });
}

export async function getOrder(id, customer) {
  const filter = { _id: id };
  if (customer !== undefined) filter.customer = customer;
  const order = await Order.findOne(filter).lean();
  if (!order) throw notFound('Order');
  return order;
}

export function changeOrderStatus(id, status) {
  return transaction(async session => {
    const order = await Order.findById(id).session(session);
    if (!order) throw notFound('Order');
    if (order.status === status) return order;
    if (!canTransition(order.status, status)) {
      throw conflict('INVALID_ORDER_TRANSITION', `Cannot change order from ${order.status} to ${status}`);
    }

    order.status = status;
    await order.save({ session });
    if (status === 'cancelled') {
      for (const { productId, quantity } of order.items) {
        const updated = await Product.updateOne({ _id: productId }, { $inc: { stock: quantity } }, { session });
        if (updated.matchedCount !== 1) throw new Error('An ordered product record is missing');
      }
    }
    return order;
  });
}
