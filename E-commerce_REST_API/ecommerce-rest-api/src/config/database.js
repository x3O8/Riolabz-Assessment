import mongoose from 'mongoose';
import { CatalogGuard, Category, Order, Product, User } from '../models/index.js';

const guardId = 'category-topology';

export async function connectDatabase(uri, options = {}) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, ...options });
  try {
    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid') {
      throw new Error('MongoDB must be configured as a replica set or sharded cluster');
    }
    await Promise.all([CatalogGuard, Category, Order, Product, User].map(model => model.init()));
    try {
      await CatalogGuard.updateOne({ _id: guardId }, { $setOnInsert: { revision: 0 } }, { upsert: true });
    } catch (error) {
      // Another API instance may have initialized the same guard concurrently.
      if (error.code !== 11000) throw error;
    }
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
}

export function transaction(work) {
  return mongoose.connection.transaction(work, {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
    readPreference: 'primary',
  });
}

export async function lockCategoryTopology(session) {
  // The first write serializes topology edits and changes to product references.
  const result = await CatalogGuard.updateOne({ _id: guardId }, { $inc: { revision: 1 } }, { session });
  if (result.matchedCount !== 1) throw new Error('Catalog guard is missing');
}
