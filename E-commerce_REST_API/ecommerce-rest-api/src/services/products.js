import { Category, Product } from '../models/index.js';
import { lockCategoryTopology, transaction } from '../config/database.js';
import { ApiError, notFound, paginate } from '../shared/http.js';
import { subtreeIds } from './categories.js';

const sortOptions = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { effectivePrice: 1, _id: 1 },
  price_desc: { effectivePrice: -1, _id: -1 },
  name_asc: { name: 1, _id: 1 },
  name_desc: { name: -1, _id: -1 },
};

function effectivePrice(price, salePrice) {
  if (salePrice !== null && salePrice > price) {
    throw new ApiError(400, 'INVALID_SALE_PRICE', 'Sale price must be at most the regular price');
  }
  return salePrice ?? price;
}

async function requireCategory(id, session) {
  if (!await Category.exists({ _id: id }).session(session)) throw notFound('Category');
}

function productView(product) {
  const { deletedAt, ...view } = product.toObject();
  return view;
}

export function createProduct(input) {
  return transaction(async session => {
    await lockCategoryTopology(session);
    await requireCategory(input.category, session);
    const [product] = await Product.create([{
      ...input, effectivePrice: effectivePrice(input.price, input.salePrice ?? null),
    }], { session });
    return productView(product);
  });
}

export function updateProduct(id, input) {
  return transaction(async session => {
    if (input.category !== undefined) {
      await lockCategoryTopology(session);
      await requireCategory(input.category, session);
    }

    const product = await Product.findOne({ _id: id, deletedAt: null }).session(session);
    if (!product) throw notFound('Product');
    product.set(input);
    product.effectivePrice = effectivePrice(product.price, product.salePrice);
    return productView(await product.save({ session }));
  });
}

export async function deleteProduct(id) {
  const product = await Product.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: new Date() } },
  );
  if (!product) throw notFound('Product');
}

export async function listProducts(query, admin = false) {
  const { q, category, minPrice, maxPrice, sort, status, page, limit } = query;
  const filter = { deletedAt: null };
  if (!admin) filter.status = 'active';
  else if (status !== undefined) filter.status = status;

  if (q !== undefined) filter.$text = { $search: q };
  if (category !== undefined) filter.category = { $in: await subtreeIds(category) };
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.effectivePrice = {
      ...(minPrice !== undefined && { $gte: minPrice }),
      ...(maxPrice !== undefined && { $lte: maxPrice }),
    };
  }
  return paginate(Product, filter, { page, limit }, sortOptions[sort]);
}

export async function getProduct(id, admin = false) {
  const filter = { _id: id, deletedAt: null };
  if (!admin) filter.status = 'active';
  const product = await Product.findOne(filter).lean();
  if (!product) throw notFound('Product');
  return product;
}
