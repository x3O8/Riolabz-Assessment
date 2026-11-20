export function buildCategoryTree(categories) {
  const nodes = new Map(categories.map(category => [
    String(category._id), { ...category, children: [] },
  ]));
  const roots = [];
  for (const node of nodes.values()) {
    if (node.parent === null) {
      roots.push(node);
    } else {
      nodes.get(String(node.parent)).children.push(node);
    }
  }
  return roots;
}

export function findSubtreeIds(categories, rootId) {
  const root = String(rootId);
  if (!categories.some(category => String(category._id) === root)) return [];

  const childrenByParent = new Map();
  for (const { _id, parent } of categories) {
    if (parent === null) continue;
    const parentId = String(parent);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(String(_id));
  }

  const ids = [root];
  const visited = new Set(ids);
  for (let index = 0; index < ids.length; index++) {
    for (const child of childrenByParent.get(ids[index]) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      ids.push(child);
    }
  }
  return ids;
}
