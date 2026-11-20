import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCategoryTree, findSubtreeIds } from '../src/domain/categories.js';
import { canTransition, fingerprintItems, normalizeItems } from '../src/domain/order.js';
import { hashPassword, verifyPassword } from '../src/domain/passwords.js';

test('creates a deeply nested tree from unordered category records', () => {
  const categories = Array.from({ length: 1000 }, (_, index) => ({
    _id: String(index), parent: index === 0 ? null : String(index - 1),
  })).reverse();
  const tree = buildCategoryTree(categories);
  assert.equal(tree.length, 1);
  let node = tree[0];
  for (let index = 0; index < 1000; index++) {
    assert.equal(node._id, String(index));
    assert.equal(node.children.length, index === 999 ? 0 : 1);
    [node] = node.children;
  }
  assert.equal(findSubtreeIds(categories, '0').length, 1000);
});

test('a subtree contains its root and descendants, and excludes siblings and unrelated branches', () => {
  const categories = [
    { _id: 'leaf', parent: 'child' },
    { _id: 'other', parent: null },
    { _id: 'child', parent: 'branch' },
    { _id: 'sibling', parent: 'root' },
    { _id: 'root', parent: null },
    { _id: 'branch', parent: 'root' },
  ];
  assert.deepEqual(findSubtreeIds(categories, 'branch'), ['branch', 'child', 'leaf']);
  assert.deepEqual(findSubtreeIds(categories, 'leaf'), ['leaf']);
  assert.deepEqual(findSubtreeIds(categories, 'missing'), []);
  categories.find(category => category._id === 'branch').parent = 'other';
  assert.deepEqual(findSubtreeIds(categories, 'root'), ['root', 'sibling']);
  assert.deepEqual(findSubtreeIds(categories, 'other'), ['other', 'branch', 'child', 'leaf']);
});

test('canonicalizes duplicate product lines for stock reservation and idempotency', () => {
  const grouped = normalizeItems([
    { productId: 'B', quantity: 2 }, { productId: 'A', quantity: 1 }, { productId: 'B', quantity: 3 },
  ]);
  const expected = [{ productId: 'A', quantity: 1 }, { productId: 'B', quantity: 5 }];
  assert.deepEqual(grouped, expected);
  assert.equal(fingerprintItems(grouped), fingerprintItems(expected));
  assert.notEqual(fingerprintItems(grouped), fingerprintItems(expected.slice(1)));
});

test('connects order statuses in sequence and prevents changing terminal statuses', () => {
  assert.equal(canTransition('pending', 'confirmed'), true);
  assert.equal(canTransition('confirmed', 'processing'), true);
  assert.equal(canTransition('processing', 'shipped'), true);
  assert.equal(canTransition('shipped', 'delivered'), true);
  assert.equal(canTransition('shipped', 'cancelled'), true);
  assert.equal(canTransition('pending', 'shipped'), false);
  assert.equal(canTransition('delivered', 'cancelled'), false);
  assert.equal(canTransition('cancelled', 'confirmed'), false);
});

test('uses independent salts and verifies scrypt password hashes', async () => {
  const password = 'a random example password';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.notEqual(first, password);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('a different password', first), false);
});
