import { User } from '../models/index.js';
import { ApiError } from '../shared/http.js';
import { verifyToken } from '../services/users.js';

const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'A valid access token is required');

export function authenticate(secret) {
  return async (req, _res, next) => {
    const token = /^Bearer (\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
    if (!token) throw unauthorized();

    let claims;
    try {
      claims = verifyToken(token, secret);
    } catch {
      throw unauthorized();
    }

    if (typeof claims.sub !== 'string' || !/^[a-f\d]{24}$/.test(claims.sub)
      || !Number.isSafeInteger(claims.ver)) {
      throw unauthorized();
    }

    const user = await User.findById(claims.sub).select('+tokenVersion').lean();
    if (!user?.active || user.tokenVersion !== claims.ver) throw unauthorized();

    const { tokenVersion, ...profile } = user;
    req.user = profile;
    next();
  };
}

export function requireRole(role) {
  return (req, _res, next) => {
    if (req.user.role !== role) {
      throw new ApiError(403, 'FORBIDDEN', 'Your role cannot perform this action');
    }
    next();
  };
}
