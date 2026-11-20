import { Category, Product } from '../models/index.js';
import { lockCategoryTopology, transaction } from '../config/database.js';
import { buildCategoryTree, findSubtreeIds } from '../domain/categories.js';
import { conflict, notFound } from '../shared/http.js';

const publicFields = '_id name parent createdAt updatedAt';

function categoryView({ _id, name, parent, createdAt, updatedAt }) {
  return { _id, name, parent, createdAt, updatedAt };
}

async function checkParent(parentId, session) {
  if (parentId !== null && !await Category.exists({ _id: parentId }).session(session)) {
    throw notFound('Parent category');
  }
}

export function listCategories() {
  return Category.find().select(publicFields).sort({ name: 1, _id: 1 }).lean();
}

export async function getCategoryTree() {
  return buildCategoryTree(await listCategories());
}

export function createCategory({ name, parent = null }) {
  return transaction(async session => {
    await lockCategoryTopology(session);
    await checkParent(parent, session);
    const [category] = await Category.create([{ name, nameKey: name.toLowerCase(), parent }], { session });
    return categoryView(category);
  });
}

export function updateCategory(id, { name, parent }) {
  return transaction(async session => {
    await lockCategoryTopology(session);
    const category = await Category.findById(id).session(session);
    if (!category) throw notFound('Category');

    if (name !== undefined) {
      category.name = name;
      category.nameKey = name.toLowerCase();
    }
    const previousParentId = category.parent === null ? null : String(category.parent);
    if (parent !== undefined && parent !== previousParentId) {
      await checkParent(parent, session);
      if (parent !== null && (await subtreeIds(id, session)).includes(parent)) {
        throw conflict('CATEGORY_CYCLE', 'A category cannot be moved below itself or its descendants');
      }
      category.parent = parent;
    }
    return categoryView(await category.save({ session }));
  });
}

export function deleteCategory(id) {
  return transaction(async session => {
    await lockCategoryTopology(session);
    const category = await Category.findById(id).session(session).lean();
    if (!category) throw notFound('Category');

    const hasChildren = await Category.exists({ parent: id }).session(session);
    const hasProducts = await Product.exists({ category: id, deletedAt: null }).session(session);
    if (hasChildren || hasProducts) {
      throw conflict('CATEGORY_IN_USE', 'Remove or move child categories and products before deleting this category');
    }
    await Category.deleteOne({ _id: id }, { session });
  });
}

export async function subtreeIds(id, session = null) {
  const categories = await Category.find().select('_id parent').session(session).lean();
  const ids = findSubtreeIds(categories, id);
  if (ids.length === 0) throw notFound('Category');
  return ids;
}
