import mongoose from 'mongoose';
import { orderStatuses } from '../domain/order.js';

const { Schema, model } = mongoose;
const objectId = Schema.Types.ObjectId;
const timestamps = { timestamps: true, versionKey: false };
const wholeNumber = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'customer'], required: true, default: 'customer' },
  active: { type: Boolean, required: true, default: true },
  tokenVersion: { ...wholeNumber, default: 0, select: false },
}, timestamps);
userSchema.index({ createdAt: -1, _id: -1 });
userSchema.index({ role: 1, active: 1, createdAt: -1, _id: -1 });

const categorySchema = new Schema({
  name: { type: String, required: true },
  nameKey: { type: String, required: true, select: false },
  parent: { type: objectId, ref: 'Category', default: null },
}, timestamps);
categorySchema.index({ parent: 1, nameKey: 1 }, { unique: true });

const productSchema = new Schema({
  name: { type: String, required: true },
  sku: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  price: wholeNumber,
  salePrice: { type: Number, default: null, min: 0, validate: Number.isSafeInteger },
  effectivePrice: wholeNumber,
  stock: wholeNumber,
  category: { type: objectId, ref: 'Category', required: true },
  status: { type: String, enum: ['active', 'inactive'], required: true, default: 'active' },
  deletedAt: { type: Date, default: null, select: false },
}, timestamps);
productSchema.index({ name: 'text', sku: 'text', description: 'text' }, {
  weights: { name: 8, sku: 12, description: 1 }, default_language: 'none',
});
productSchema.index({ category: 1, deletedAt: 1, status: 1, effectivePrice: 1, _id: 1 });
productSchema.index({ deletedAt: 1, status: 1, effectivePrice: 1, _id: 1 });
productSchema.index({ deletedAt: 1, status: 1, createdAt: -1, _id: -1 });
productSchema.index({ deletedAt: 1, createdAt: -1, _id: -1 });

const orderItemSchema = new Schema({
  productId: { type: objectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  sku: { type: String, required: true },
  quantity: { ...wholeNumber, min: 1 },
  unitPrice: wholeNumber,
  lineTotal: wholeNumber,
}, { _id: false });

const orderSchema = new Schema({
  customer: { type: objectId, ref: 'User', required: true },
  items: { type: [orderItemSchema], required: true, validate: items => items.length > 0 },
  total: wholeNumber,
  status: { type: String, enum: orderStatuses, required: true, default: 'pending' },
  idempotencyKey: { type: String, select: false },
  requestFingerprint: { type: String, select: false },
}, timestamps);
orderSchema.index({ customer: 1, createdAt: -1, _id: -1 });
orderSchema.index({ customer: 1, status: 1, createdAt: -1, _id: -1 });
orderSchema.index({ status: 1, createdAt: -1, _id: -1 });
orderSchema.index({ createdAt: -1, _id: -1 });
orderSchema.index({ customer: 1, idempotencyKey: 1 }, {
  unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } },
});

const catalogGuardSchema = new Schema({
  _id: String, revision: { type: Number, required: true },
}, { versionKey: false });

export const User = model('User', userSchema);
export const Category = model('Category', categorySchema);
export const Product = model('Product', productSchema);
export const Order = model('Order', orderSchema);
export const CatalogGuard = model('CatalogGuard', catalogGuardSchema);
