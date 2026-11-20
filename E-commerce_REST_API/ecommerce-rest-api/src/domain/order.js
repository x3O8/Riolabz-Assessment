import { createHash } from 'node:crypto';

const transitions = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export const orderStatuses = Object.keys(transitions);

export function canTransition(from, to) {
  return transitions[from].includes(to);
}

export function normalizeItems(items) {
  const quantities = new Map();
  for (const { productId, quantity } of items) {
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }
  return [...quantities.keys()].sort().map(productId => ({
    productId, quantity: quantities.get(productId),
  }));
}

export function fingerprintItems(items) {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex');
}
