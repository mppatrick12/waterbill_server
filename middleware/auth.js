import { supabase } from '../config/supabase.js';
import { ROLES } from '../config/constants.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Try supabase.auth.getUser up to `maxAttempts` times with exponential back-off.
 *  Returns { user, error } — never throws. */
async function getSupabaseUser(token, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error) return { user, error: null };
      lastError = error;

      const isRetryable =
        !error.status ||
        error.status >= 500 ||
        (error.message || '').includes('fetch failed') ||
        (error.message || '').includes('timeout') ||
        (error.message || '').includes('ENOTFOUND') ||
        (error.message || '').includes('connect');

      if (!isRetryable) return { user: null, error }; // auth error, don't retry
      if (attempt < maxAttempts) {
        console.warn(`[Auth] Supabase getUser attempt ${attempt} failed (${error.message}), retrying in ${attempt}s…`);
        await sleep(attempt * 1000);
      }
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(`[Auth] Supabase getUser threw on attempt ${attempt} (${err.message}), retrying in ${attempt}s…`);
        await sleep(attempt * 1000);
      }
    }
  }
  return { user: null, error: lastError };
}

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing or invalid authorization token' });
    }

    const token = authHeader.split(' ')[1];
    const { user, error } = await getSupabaseUser(token);

    if (error) {
      const msg = (error.message || '').toLowerCase();
      const isNetworkOrServer =
        !error.status ||
        error.status >= 500 ||
        msg.includes('fetch failed') ||
        msg.includes('timeout') ||
        msg.includes('enotfound') ||
        msg.includes('certificate') ||
        msg.includes('connect');

      if (isNetworkOrServer) {
        console.error('[Auth] Supabase Auth still unavailable after retries:', error.message || error);
        return res.status(503).json({
          success: false,
          error: 'AUTH_SERVICE_UNAVAILABLE',
          message: 'Authentication service is temporarily unavailable. Please try again in a few seconds.',
        });
      }
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({ success: false, error: 'User profile not found' });
    }

    req.user = user;
    req.profile = profile;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.profile) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.profile.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }
  return authenticate(req, res, next);
}

export { ROLES };
