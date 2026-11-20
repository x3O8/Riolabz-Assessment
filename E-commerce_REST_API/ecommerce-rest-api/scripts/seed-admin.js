import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/database.js';
import { readConfig } from '../src/config/env.js';
import { hashPassword } from '../src/domain/passwords.js';
import { User } from '../src/models/index.js';
import { newAccount } from '../src/routes/schemas.js';

try {
  const config = readConfig();
  const result = newAccount.safeParse({
    name: process.env.ADMIN_NAME ?? 'Store Admin',
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (!result.success) throw new Error('Set valid ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD values');
  const { name, email, password } = result.data;

  await connectDatabase(config.MONGODB_URI);
  const existing = await User.findOne({ email }).lean();
  if (existing?.role === 'admin') {
    console.log('Admin already exists. Existing credentials and account status were preserved.');
  } else if (existing) {
    throw new Error('This email is already registered to a customer');
  } else {
    await User.create({ name, email, passwordHash: await hashPassword(password), role: 'admin' });
    console.log('Admin account created.');
  }
} catch (error) {
  const expected = /^(Set valid ADMIN|This email|Invalid configuration|MongoDB must)/.test(error.message);
  console.error(expected ? error.message : `Admin setup failed (${error.code ?? error.name})`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
