import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../domain/passwords.js';
import { ApiError, conflict, notFound, paginate } from '../shared/http.js';

const issuer = 'ecommerce-api';
const audience = 'ecommerce-clients';

function userView(user) {
  const { _id, name, email, role, active, createdAt, updatedAt } = user;
  return { _id, name, email, role, active, createdAt, updatedAt };
}

export async function register({ name, email, password }) {
  const passwordHash = await hashPassword(password);
  return userView(await User.create({ name, email, passwordHash, role: 'customer' }));
}

export async function login({ email, password }, config) {
  const user = await User.findOne({ email }).select('+passwordHash +tokenVersion').lean();
  const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
  if (!user?.active || !valid) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const token = jwt.sign({ ver: user.tokenVersion }, config.JWT_SECRET, {
    algorithm: 'HS256',
    issuer,
    audience,
    subject: String(user._id),
    expiresIn: config.JWT_TTL_SECONDS,
  });
  return { user: userView(user), token, expiresIn: config.JWT_TTL_SECONDS };
}

export function verifyToken(token, secret) {
  return jwt.verify(token, secret, { algorithms: ['HS256'], issuer, audience });
}

export function listUsers({ role, active, ...paging }) {
  const filter = {};
  if (role !== undefined) filter.role = role;
  if (active !== undefined) filter.active = active;
  return paginate(User, filter, paging, { createdAt: -1, _id: -1 });
}

export async function changeUserStatus(adminId, userId, active) {
  if (adminId === userId && !active) {
    throw conflict('SELF_DEACTIVATION', 'An admin cannot deactivate their own account');
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId, active: { $ne: active } },
    { $set: { active }, $inc: { tokenVersion: 1 } },
    { returnDocument: 'after' },
  ).lean();
  const user = updated ?? await User.findById(userId).lean();
  if (!user) throw notFound('User');
  return userView(user);
}
