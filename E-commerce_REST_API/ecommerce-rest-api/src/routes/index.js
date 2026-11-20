import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { send } from '../shared/http.js';
import { idParams, validate } from '../shared/validation.js';
import * as users from '../services/users.js';
import * as categories from '../services/categories.js';
import * as products from '../services/products.js';
import * as orders from '../services/orders.js';
import * as schema from './schemas.js';

export function apiRoutes(config, authLimiter) {
  const api = Router();
  const auth = authenticate(config.JWT_SECRET);
  const customerOnly = requireRole('customer');

  const accounts = Router();
  accounts.post('/register', authLimiter, validate({ body: schema.newAccount }), async (req, res) =>
    send(res, await users.register(req.input.body), 201));
  accounts.post('/login', authLimiter, validate({ body: schema.loginBody }), async (req, res) =>
    send(res, await users.login(req.input.body, config)));
  api.use('/auth', accounts);
  api.get('/users/me', auth, (req, res) => send(res, req.user));

  api.get('/categories/tree', async (_req, res) => send(res, await categories.getCategoryTree()));
  api.get('/products', validate({ query: schema.publicProductsQuery }), async (req, res) =>
    res.json(await products.listProducts(req.input.query)));
  api.get('/products/:id', validate({ params: idParams }), async (req, res) =>
    send(res, await products.getProduct(req.input.params.id)));

  const customerOrders = Router();
  customerOrders.use(auth, customerOnly);
  customerOrders.post('/', validate({ body: schema.orderBody, headers: schema.orderHeaders }), async (req, res) => {
    const { order, created } = await orders.placeOrder(
      req.user._id, req.input.body.items, req.input.headers['idempotency-key'],
    );
    return send(res, order, created ? 201 : 200);
  });
  customerOrders.get('/', validate({ query: schema.ordersQuery }), async (req, res) =>
    res.json(await orders.listOrders({ ...req.input.query, customer: req.user._id })));
  customerOrders.get('/:id', validate({ params: idParams }), async (req, res) =>
    send(res, await orders.getOrder(req.input.params.id, req.user._id)));
  api.use('/orders', customerOrders);

  const admin = Router();
  admin.use(auth, requireRole('admin'));

  admin.get('/users', validate({ query: schema.usersQuery }), async (req, res) =>
    res.json(await users.listUsers(req.input.query)));
  admin.patch('/users/:id/status', validate({ params: idParams, body: schema.userStatusBody }), async (req, res) =>
    send(res, await users.changeUserStatus(String(req.user._id), req.input.params.id, req.input.body.active)));

  admin.get('/categories', async (_req, res) => send(res, await categories.listCategories()));
  admin.post('/categories', validate({ body: schema.categoryBody }), async (req, res) =>
    send(res, await categories.createCategory(req.input.body), 201));
  admin.patch('/categories/:id', validate({ params: idParams, body: schema.categoryPatch }), async (req, res) =>
    send(res, await categories.updateCategory(req.input.params.id, req.input.body)));
  admin.delete('/categories/:id', validate({ params: idParams }), async (req, res) => {
    await categories.deleteCategory(req.input.params.id);
    res.status(204).end();
  });

  admin.get('/products', validate({ query: schema.adminProductsQuery }), async (req, res) =>
    res.json(await products.listProducts(req.input.query, true)));
  admin.get('/products/:id', validate({ params: idParams }), async (req, res) =>
    send(res, await products.getProduct(req.input.params.id, true)));
  admin.post('/products', validate({ body: schema.productBody }), async (req, res) =>
    send(res, await products.createProduct(req.input.body), 201));
  admin.patch('/products/:id', validate({ params: idParams, body: schema.productPatch }), async (req, res) =>
    send(res, await products.updateProduct(req.input.params.id, req.input.body)));
  admin.delete('/products/:id', validate({ params: idParams }), async (req, res) => {
    await products.deleteProduct(req.input.params.id);
    res.status(204).end();
  });

  admin.get('/orders', validate({ query: schema.adminOrdersQuery }), async (req, res) =>
    res.json(await orders.listOrders(req.input.query)));
  admin.get('/orders/:id', validate({ params: idParams }), async (req, res) =>
    send(res, await orders.getOrder(req.input.params.id)));
  admin.patch('/orders/:id/status', validate({ params: idParams, body: schema.orderStatusBody }), async (req, res) =>
    send(res, await orders.changeOrderStatus(req.input.params.id, req.input.body.status)));

  api.use('/admin', admin);
  return api;
}
