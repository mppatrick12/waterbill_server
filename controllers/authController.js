import { supabase } from '../config/supabase.js';
import { ROLES, ACCOUNT_STATUS } from '../config/constants.js';

export async function register(req, res, next) {
  try {
    const { email, username, password, fullName, full_name, phone, role = ROLES.CUSTOMER } = req.body;
    const name = (fullName || full_name || '').trim();
    const loginEmail = (email || username || '').trim().toLowerCase();

    if (!loginEmail || !password || !name) {
      return res.status(400).json({ success: false, error: 'Username, password, and full name are required' });
    }

    const allowedRoles = Object.values(ROLES);
    const userRole = allowedRoles.includes(role) ? role : ROLES.CUSTOMER;

    if (userRole !== ROLES.CUSTOMER && !req.body.adminSecret) {
      return res.status(403).json({ success: false, error: 'Admin secret required for privileged roles' });
    }

    if (userRole !== ROLES.CUSTOMER && req.body.adminSecret !== process.env.ADMIN_REGISTRATION_SECRET) {
      return res.status(403).json({ success: false, error: 'Invalid admin secret' });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true,
    });

    let authUser = authData?.user || null;
    if (authError) {
      // Common recovery path: profile was deleted, but auth user still exists.
      if (authError.message?.toLowerCase().includes('already been registered')) {
        const { data: listed, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) return res.status(400).json({ success: false, error: listError.message });

        authUser = listed?.users?.find((u) => (u.email || '').toLowerCase() === loginEmail) || null;
        if (!authUser) {
          return res.status(400).json({ success: false, error: authError.message });
        }

        // Refresh password for reclaimed accounts so user can log in immediately.
        const { error: passwordUpdateError } = await supabase.auth.admin.updateUserById(authUser.id, { password });
        if (passwordUpdateError) {
          console.warn('Password refresh failed for existing auth user:', passwordUpdateError.message);
        }
      } else {
        return res.status(400).json({ success: false, error: authError.message });
      }
    }

    const isAdminCreated = !!req.body.adminSecret;
    const accountStatus =
      userRole === ROLES.CUSTOMER && !isAdminCreated
        ? ACCOUNT_STATUS.PENDING
        : ACCOUNT_STATUS.APPROVED;

    const { data: existingProfile, error: profileFetchError } = await supabase
      .from('profiles')
      .select('id, user_id, email')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (profileFetchError) {
      return res.status(400).json({ success: false, error: profileFetchError.message });
    }

    if (existingProfile) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists.',
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        user_id: authUser.id,
        email: loginEmail,
        username: username || loginEmail,
        full_name: name,
        phone: phone || null,
        role: userRole,
        account_status: accountStatus,
      })
      .select()
      .single();

    if (profileError) return res.status(400).json({ success: false, error: profileError.message });

    if (userRole === ROLES.CUSTOMER && accountStatus === ACCOUNT_STATUS.APPROVED) {
      const { createCard } = await import('../services/cardService.js');
      try {
        await createCard(authUser.id);
      } catch (e) {
        console.warn('Auto card creation failed:', e.message);
      }
    }

    res.status(201).json({
      success: true,
      user: authUser,
      profile,
      message:
        userRole === ROLES.CUSTOMER
          ? 'Registration received. A manager will review and approve your account.'
          : 'Account created successfully.',
    });
  } catch (err) {
    next(err);
  }
}

function mapAuthError(error) {
  const msg = error?.message || 'Login failed';
  if (msg.includes('fetch failed') || msg.includes('ENOTFOUND') || msg.includes('certificate')) {
    return {
      status: 503,
      error: 'AUTH_SERVICE_UNAVAILABLE',
      message:
        'Cannot connect to the database. Check SUPABASE_URL in backend/.env (use https://xxx.supabase.co without /rest/v1) and restart the API.',
    };
  }
  if (msg.toLowerCase().includes('invalid login credentials')) {
    return { status: 401, error: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' };
  }
  return { status: 401, error: 'LOGIN_FAILED', message: msg };
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const mapped = mapAuthError(error);
      return res.status(mapped.status).json({
        success: false,
        error: mapped.error,
        message: mapped.message,
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', data.user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({
        success: false,
        error: 'PROFILE_NOT_FOUND',
        message: 'Account exists but profile is missing. Contact support or run admin setup.',
      });
    }

    if (profile?.role === ROLES.CUSTOMER) {
      const status = profile.account_status || ACCOUNT_STATUS.APPROVED;
      if (status === ACCOUNT_STATUS.PENDING) {
        return res.status(403).json({
          success: false,
          error: 'ACCOUNT_PENDING_APPROVAL',
          message: 'Your account is pending manager approval. You will be notified once approved.',
        });
      }
      if (status === ACCOUNT_STATUS.REJECTED) {
        return res.status(403).json({
          success: false,
          error: 'ACCOUNT_REJECTED',
          message: 'Your registration was not approved. Please contact support.',
        });
      }
    }

    res.json({ success: true, session: data.session, user: data.user, profile });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req, res) {
  res.json({ success: true, user: req.user, profile: req.profile });
}

/** One-time: create default admin if missing (production setup). */
export async function ensureAdmin(req, res, next) {
  try {
    const secret = req.body.setupSecret || req.body.adminSecret;
    if (secret !== process.env.ADMIN_REGISTRATION_SECRET) {
      return res.status(403).json({ success: false, error: 'Invalid setup secret' });
    }

    const email = process.env.SEED_ADMIN_EMAIL || 'admin@smartwaterbill.local';
    const password = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';
    const fullName = process.env.SEED_ADMIN_NAME || 'System Admin';

    const { data: existing } = await supabase
      .from('profiles')
      .select('id, user_id, role')
      .eq('email', email)
      .maybeSingle();

    if (existing?.role === ROLES.ADMIN) {
      return res.json({
        success: true,
        message: 'Admin already exists. Use login with your admin email and password.',
        email,
      });
    }

    let userId = existing?.user_id;
    if (!userId) {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authError) {
        if (authError.message?.includes('already been registered')) {
          const { data: list } = await supabase.auth.admin.listUsers();
          const found = list?.users?.find((u) => u.email === email);
          userId = found?.id;
        } else {
          return res.status(400).json({ success: false, error: authError.message });
        }
      } else {
        userId = authData.user.id;
      }
    }

    if (existing) {
      await supabase
        .from('profiles')
        .update({ role: ROLES.ADMIN, account_status: ACCOUNT_STATUS.APPROVED, username: email })
        .eq('email', email);
    } else {
      await supabase.from('profiles').insert({
        user_id: userId,
        email,
        username: email,
        full_name: fullName,
        role: ROLES.ADMIN,
        account_status: ACCOUNT_STATUS.APPROVED,
      });
    }

    res.json({
      success: true,
      message: 'Admin ready. Sign in at /login',
      email,
      password,
    });
  } catch (err) {
    next(err);
  }
}
