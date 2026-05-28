import { supabase } from '../config/supabase.js';
import { ROLES, ACCOUNT_STATUS } from '../config/constants.js';

export async function listUsers(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, user_id, username, full_name, email, phone, role, account_status, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ success: true, users: data });
  } catch (err) {
    next(err);
  }
}

export async function listPendingCustomers(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, user_id, username, full_name, email, phone, role, account_status, created_at')
      .eq('role', ROLES.CUSTOMER)
      .eq('account_status', ACCOUNT_STATUS.PENDING)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ success: true, users: data });
  } catch (err) {
    next(err);
  }
}

export async function updateAccountApproval(req, res, next) {
  try {
    const { status } = req.body;
    if (![ACCOUNT_STATUS.APPROVED, ACCOUNT_STATUS.REJECTED].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be approved or rejected' });
    }

    const userId = req.params.userId;
    const { data: existing, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (existing.role !== ROLES.CUSTOMER) {
      return res.status(400).json({ success: false, error: 'Only customer accounts require approval' });
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .update({ account_status: status, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    if (status === ACCOUNT_STATUS.APPROVED) {
      const { data: cards } = await supabase.from('cards').select('id').eq('user_id', userId).limit(1);
      if (!cards?.length) {
        const { createCard } = await import('../services/cardService.js');
        try {
          await createCard(userId);
        } catch (e) {
          console.warn('Card creation on approval failed:', e.message);
        }
      }
    }

    res.json({
      success: true,
      profile,
      message:
        status === ACCOUNT_STATUS.APPROVED
          ? 'Customer approved. They can now sign in and use water services.'
          : 'Customer registration rejected.',
    });
  } catch (err) {
    next(err);
  }
}

export async function updateUserRole(req, res, next) {
  try {
    const { role } = req.body;
    const { data, error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('user_id', req.params.userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json({ success: true, profile: data });
  } catch (err) {
    next(err);
  }
}

export async function createUser(req, res, next) {
  try {
    const { email, username, password = '12345678', fullName, full_name, phone, role = ROLES.CUSTOMER } = req.body;
    const name = (fullName || full_name || '').trim();
    const loginEmail = (email || username || '').trim().toLowerCase();

    if (!loginEmail || !password || !name) {
      return res.status(400).json({ success: false, error: 'Email, password, and full name are required' });
    }

    const allowedRoles = [ROLES.CUSTOMER, ROLES.WASAC_MANAGER];
    const userRole = allowedRoles.includes(role) ? role : ROLES.CUSTOMER;

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true,
    });

    let authUser = authData?.user || null;
    if (authError) {
      if (authError.message?.toLowerCase().includes('already been registered')) {
        const { data: listed, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) return res.status(400).json({ success: false, error: listError.message });

        authUser = listed?.users?.find((u) => (u.email || '').toLowerCase() === loginEmail) || null;
        if (!authUser) {
          return res.status(400).json({ success: false, error: authError.message });
        }

        const { error: passwordUpdateError } = await supabase.auth.admin.updateUserById(authUser.id, { password });
        if (passwordUpdateError) {
          console.warn('Password refresh failed for existing auth user:', passwordUpdateError.message);
        }
      } else {
        return res.status(400).json({ success: false, error: authError.message });
      }
    }

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
        account_status: ACCOUNT_STATUS.APPROVED,
      })
      .select()
      .single();

    if (profileError) return res.status(400).json({ success: false, error: profileError.message });

    if (userRole === ROLES.CUSTOMER) {
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
      message: 'User created successfully.',
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(req, res, next) {
  try {
    const userId = req.params.userId;

    // Remove profile first so the app state is cleaned even if auth user is already missing.
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('user_id', userId);
    if (profileError) throw new Error(profileError.message);

    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) {
      const msg = authError.message?.toLowerCase() || '';
      const isNotFound = msg.includes('not found') || msg.includes('does not exist') || msg.includes('user not found');
      if (!isNotFound) {
        throw new Error(authError.message);
      }
    }

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
}
