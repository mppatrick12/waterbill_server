/** Production frontend — always allowed even if env vars are missing on Render */
const DEFAULT_ORIGINS = [
  'https://water-bill-gamma.vercel.app',
  'https://water-bill-system.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/** Comma-separated origins: ALLOWED_ORIGINS or FRONTEND_URL */
export function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '';
  const fromEnv = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

export function corsOptions() {
  const allowed = getAllowedOrigins();

  return {
    origin: allowed,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 204,
    preflightContinue: false,
  };
}

/** Backup CORS headers (preflight + errors) */
export function corsPreflightMiddleware(req, res, next) {
  const allowed = getAllowedOrigins();
  const origin = req.headers.origin;

  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    return res.status(204).end();
  }

  next();
}
