import { getAllowedOrigins } from '../config/cors.js';

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && getAllowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

export function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message);
  applyCorsHeaders(req, res);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

export function notFound(req, res) {
  applyCorsHeaders(req, res);
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
}

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
