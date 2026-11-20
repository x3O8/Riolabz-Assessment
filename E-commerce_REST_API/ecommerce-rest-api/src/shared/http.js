export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(resource) {
  return new ApiError(404, 'NOT_FOUND', `${resource} not found`);
}

export function conflict(code, message, details) {
  return new ApiError(409, code, message, details);
}

export function send(res, data, status = 200) {
  return res.status(status).json({ data });
}

export async function paginate(model, filter, { page, limit }, sort) {
  const [data, total] = await Promise.all([
    model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    model.countDocuments(filter),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
