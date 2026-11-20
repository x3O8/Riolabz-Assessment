import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/config/database.js';
import { readConfig } from '../src/config/env.js';
import { hashPassword } from '../src/domain/passwords.js';
import { User } from '../src/models/index.js';

const uri = process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI
  ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true';
const dbName = `ecommerce_test_${randomBytes(8).toString('hex')}`;
const testPassword = 'test-password-431';
const config = readConfig({
  NODE_ENV: 'test', MONGODB_URI: uri, JWT_SECRET: randomBytes(48).toString('base64url'),
  LOG_LEVEL: 'silent', AUTH_RATE_LIMIT: '1000', API_RATE_LIMIT: '1000',
});
let server;
let baseUrl;
let admin;

before(async () => {
  await connectDatabase(uri, { dbName });
  await User.create({
    name: 'Admin', email: 'admin@example.com', role: 'admin',
    passwordHash: await hashPassword(testPassword),
  });
  server = createApp(config).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  admin = (await login('admin@example.com')).data.token;
});

after(async () => {
  try {
    if (server?.listening) await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName) {
      await mongoose.connection.dropDatabase();
    }
  } finally {
    await mongoose.disconnect();
  }
});

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    ...(response.status === 204 ? {} : await response.json()),
  };
}

async function check(status, path, options) {
  const result = await request(path, options);
  assert.equal(result.status, status, JSON.stringify(result.error));
  return result;
}

function login(email, status = 200) {
  return check(status, '/auth/login', { method: 'POST', body: { email, password: testPassword } });
}

async function customer(prefix) {
  const email = `${prefix}@example.com`;
  const { data } = await check(201, '/auth/register', {
    method: 'POST', body: { name: prefix, email, password: testPassword },
  });
  return { ...data, token: (await login(email)).data.token };
}

async function category(name, parent = null) {
  return (await check(201, '/admin/categories', {
    method: 'POST', token: admin, body: { name, parent },
  })).data;
}

async function product(categoryId, sku, overrides = {}) {
  return (await check(201, '/admin/products', {
    method: 'POST', token: admin,
    body: { name: sku, sku, price: 1999, category: categoryId, stock: 10, ...overrides },
  })).data;
}

function place(token, items, key, status = 201) {
  return check(status, '/orders', {
    method: 'POST', token, body: { items }, headers: key ? { 'idempotency-key': key } : {},
  });
}

async function currentStock(id) {
  return (await check(200, `/admin/products/${id}`, { token: admin })).data.stock;
}

test('validates credentials, restricts admin access and revokes old tokens on deactivation', async () => {
  await check(401, '/users/me');
  await check(400, '/auth/register', {
    method: 'POST',
    body: { name: 'Escalation', email: 'role@example.com', password: testPassword, role: 'admin' },
  });
  const user = await customer('profile');
  assert.equal(user.role, 'customer');
  await check(409, '/auth/register', {
    method: 'POST',
    body: { name: user.name, email: user.email.toUpperCase(), password: testPassword },
  });
  const { data: profile } = await check(200, '/users/me', { token: user.token });
  assert.equal(profile._id, user._id);
  assert.equal(profile.passwordHash, undefined);
  assert.equal(profile.tokenVersion, undefined);
  await check(403, '/admin/users', { token: user.token });
  const path = `/admin/users/${user._id}/status`;
  await check(200, path, { method: 'PATCH', token: admin, body: { active: false } });
  const disabled = await check(200, '/admin/users?active=false&role=customer', { token: admin });
  assert.deepEqual(disabled.data.map(account => account._id), [user._id]);
  await check(401, '/users/me', { token: user.token });
  await login(user.email, 401);
  await check(200, path, { method: 'PATCH', token: admin, body: { active: true } });
  await check(401, '/users/me', { token: user.token });
  const fresh = await login(user.email);
  await check(200, '/users/me', { token: fresh.data.token });
});

test('supports deep category moves, protects references and filters by every descendant', async () => {
  const electronics = await category('Electronics');
  const mobiles = await category('Mobiles', electronics._id);
  const android = await category('Android', mobiles._id);
  const samsung = await category('Samsung', android._id);
  const models = await category('Galaxy models', samsung._id);
  const warehouse = await category('Warehouse');
  const galaxy = await product(models._id, 'galaxy-1', { name: 'Galaxy phone', salePrice: 1499 });
  const cable = await product(electronics._id, 'galaxy-2', { name: 'Galaxy cable', price: 300 });
  const draft = await product(models._id, 'draft', { status: 'inactive' });
  const tree = await check(200, '/categories/tree');
  const root = tree.data.find(node => node._id === electronics._id);
  assert.equal(root.children[0].children[0].children[0].children[0]._id, models._id);

  const result = await check(200, `/products?category=${electronics._id}&q=Galaxy&sort=price_desc&limit=1&page=2`);
  assert.deepEqual(result.data.map(entry => entry._id), [cable._id]);
  assert.equal(result.pagination.total, 2);
  const filtered = await check(200, `/products?category=${electronics._id}&minPrice=1000&maxPrice=1600`);
  assert.deepEqual(filtered.data.map(entry => entry._id), [galaxy._id]);
  await check(404, `/products/${draft._id}`);
  await check(400, '/products?minPrice=100&maxPrice=50');
  await check(404, `/admin/products/${galaxy._id}`, {
    method: 'PATCH', token: admin, body: { category: '000000000000000000000000' },
  });
  await check(400, `/admin/products/${galaxy._id}`, {
    method: 'PATCH', token: admin, body: { price: 500 },
  });
  await check(409, `/admin/categories/${electronics._id}`, {
    method: 'PATCH', token: admin, body: { parent: models._id },
  });
  await check(409, `/admin/categories/${models._id}`, { method: 'DELETE', token: admin });
  await check(200, `/admin/categories/${mobiles._id}`, {
    method: 'PATCH', token: admin, body: { parent: warehouse._id },
  });
  const oldBranch = await check(200, `/products?category=${electronics._id}`);
  const newBranch = await check(200, `/products?category=${warehouse._id}`);
  assert.deepEqual(oldBranch.data.map(entry => entry._id), [cable._id]);
  assert.deepEqual(newBranch.data.map(entry => entry._id), [galaxy._id]);
});

test('prevents two concurrent reparent operations from creating a cycle', async () => {
  const left = await category('Left');
  const right = await category('Right');
  const move = (id, parent) => request(`/admin/categories/${id}`, {
    method: 'PATCH', token: admin, body: { parent },
  });
  const results = await Promise.all([move(left._id, right._id), move(right._id, left._id)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.status === 409).error.code, 'CATEGORY_CYCLE');
});

test('calculates immutable order totals, enforces ownership and releases stock once on cancellation', async () => {
  const buyer = await customer('buyer');
  const other = await customer('other');
  const catalogue = await category('Order catalog');
  const first = await product(catalogue._id, 'order-1', { salePrice: 1200 });
  const second = await product(catalogue._id, 'order-2', { price: 1700 });
  const items = [
    { productId: first._id, quantity: 1 }, { productId: second._id, quantity: 1 },
    { productId: first._id, quantity: 2 },
  ];
  const { data: order } = await place(buyer.token, items, 'checkout-1');
  assert.equal(order.items.length, 2);
  assert.equal(order.total, 5300);
  assert.equal(order.idempotencyKey, undefined);
  assert.equal(await currentStock(first._id), 7);
  assert.equal(await currentStock(second._id), 9);

  const retry = await place(buyer.token, items.slice().reverse(), 'checkout-1', 200);
  assert.equal(retry.data._id, order._id);
  await place(buyer.token, items.slice(1), 'checkout-1', 409);
  assert.equal(await currentStock(first._id), 7);

  const id = order._id;
  await check(404, `/orders/${id}`, { token: other.token });
  const own = await check(200, '/orders', { token: buyer.token });
  assert.deepEqual(own.data.map(entry => entry._id), [id]);
  const all = await check(200, `/admin/orders?customer=${buyer._id}`, { token: admin });
  assert.deepEqual(all.data.map(entry => entry._id), [id]);

  const status = (value, code) => check(code, `/admin/orders/${id}/status`, {
    method: 'PATCH', token: admin, body: { status: value },
  });
  await status('delivered', 409);
  await status('confirmed', 200);
  await check(200, `/admin/products/${second._id}`, {
    method: 'PATCH', token: admin, body: { price: 2000 },
  });
  const original = await check(200, `/admin/orders/${id}`, { token: admin });
  assert.equal(original.data.total, 5300);
  await Promise.all([status('cancelled', 200), status('cancelled', 200)]);
  await status('processing', 409);
  assert.equal(await currentStock(first._id), 10);
  assert.equal(await currentStock(second._id), 10);
});

test('rolls back all stock during a failed order and prevents concurrent overselling', async () => {
  const buyer = await customer('race-buyer');
  const catalogue = await category('Race catalog');
  const products = [
    await product(catalogue._id, 'race-1', { stock: 1 }),
    await product(catalogue._id, 'race-2', { stock: 1 }),
  ].sort((left, right) => left._id.localeCompare(right._id));
  const [inStock, insufficient] = products;
  const failed = await place(buyer.token, [
    { productId: inStock._id, quantity: 1 },
    { productId: insufficient._id, quantity: 2 },
  ], undefined, 409);
  assert.equal(failed.error.code, 'INSUFFICIENT_STOCK');
  assert.equal(await currentStock(inStock._id), 1);
  const noOrders = await check(200, '/orders', { token: buyer.token });
  assert.equal(noOrders.pagination.total, 0);

  const competing = () => request('/orders', {
    method: 'POST', token: buyer.token, body: { items: [{ productId: inStock._id, quantity: 1 }] },
  });
  const results = await Promise.all([competing(), competing()]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(await currentStock(inStock._id), 0);
});
