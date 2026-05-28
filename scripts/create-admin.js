/**
 * Create an admin user for Smart Water Bill (run once).
 * Usage: node scripts/create-admin.js
 * Requires backend/.env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */
import { supabase, normalizeSupabaseUrl } from '../config/supabase.js';
import { ROLES, ACCOUNT_STATUS } from '../config/constants.js';

const email = process.env.SEED_ADMIN_EMAIL || 'admin@smartwaterbill.local';
const password = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';
const fullName = process.env.SEED_ADMIN_NAME || 'System Admin';

async function main() {
  console.log('Supabase URL:', normalizeSupabaseUrl(process.env.SUPABASE_URL) || '(missing)');

  const { data: existing } = await supabase.from('profiles').select('user_id').eq('email', email).maybeSingle();
  if (existing) {
    await supabase
      .from('profiles')
      .update({ role: ROLES.ADMIN, account_status: ACCOUNT_STATUS.APPROVED })
      .eq('email', email);
    console.log('Admin profile updated for:', email);
    console.log('Sign in at /login with your existing password.');
    return;
  }

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) {
    console.error('Auth error:', authError.message);
    process.exit(1);
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    user_id: authData.user.id,
    email,
    full_name: fullName,
    role: ROLES.ADMIN,
    account_status: ACCOUNT_STATUS.APPROVED,
  });

  if (profileError) {
    console.error('Profile error:', profileError.message);
    console.error('Run supabase/migrations/001_account_status.sql if account_status is missing.');
    process.exit(1);
  }

  console.log('Admin created successfully.');
  console.log('  Email:   ', email);
  console.log('  Password:', password);
  console.log('  Login:   http://localhost:5173/login');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
