import { z } from 'zod';
import { ApiError } from './http.js';

export const objectId = z.string().regex(/^[a-fA-F\d]{24}$/, 'Expected a MongoDB ObjectId')
  .transform(value => value.toLowerCase());

export const idParams = z.strictObject({ id: objectId });

export const trimmed = (min, max) => z.string().trim().min(min).max(max);

export const paging = {
  page: unsignedInteger(1, 100_000).default(1),
  limit: unsignedInteger(1, 100).default(20),
};

export function unsignedInteger(min, max) {
  return z.string().regex(/^\d+$/, 'Expected an unsigned integer').transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

export function nonEmptyPatch(schema) {
  return schema.partial().refine(value => Object.keys(value).length > 0, {
    message: 'Supply at least one field to update',
  });
}

export function validate(schemas) {
  return (req, _res, next) => {
    req.input = {};
    for (const [source, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed',
          result.error.issues.map(issue => ({
            field: [source, ...issue.path].join('.'), message: issue.message,
          })));
      }
      req.input[source] = result.data;
    }
    next();
  };
}
