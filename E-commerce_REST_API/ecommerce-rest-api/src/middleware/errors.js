import { ApiError, notFound } from '../shared/http.js';

export function unknownRoute(_req, _res, next) {
  next(notFound('Route'));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let response = error;
  if (error.type === 'entity.parse.failed') {
    response = new ApiError(400, 'INVALID_JSON', 'Request body contains invalid JSON');
  } else if (error.type === 'entity.too.large') {
    response = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit');
  } else if (error.status === 415) {
    response = new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request encoding');
  } else if (error instanceof URIError && error.status === 400) {
    response = new ApiError(400, 'INVALID_URL', 'Invalid URL encoding');
  } else if (error.code === 11000) {
    response = new ApiError(409, 'DUPLICATE_VALUE', 'A record with this unique value already exists');
  } else if (error.name === 'ValidationError' || error.name === 'CastError') {
    response = new ApiError(400, 'VALIDATION_ERROR', 'Data failed validation');
  } else if (['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError'].includes(error.name)) {
    response = new ApiError(503, 'SERVICE_UNAVAILABLE', 'Database temporarily unavailable');
  } else if (!(error instanceof ApiError)) {
    req.log.error({ errorName: error.name, errorCode: error.code }, 'Unexpected request error');
    response = new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  if (response.status === 401) res.set('WWW-Authenticate', 'Bearer');
  return res.status(response.status).json({
    error: {
      code: response.code,
      message: response.message,
      details: response.details,
      requestId: req.id,
    },
  });
}
