import { supabase } from '../config/supabase.js';
import { ROLES } from '../config/constants.js';

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing or invalid authorization token' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
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
