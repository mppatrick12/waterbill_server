import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const outPath = path.resolve(process.cwd(), 'dev_seed_users.json');

const sampleUsers = [
  { email: 'admin@wasac.local', password: 'Admin@1234', full_name: 'WASAC Admin', role: 'admin' },
  { email: 'manager@wasac.local', password: 'Manager@1234', full_name: 'WASAC Manager', role: 'wasac_manager' },
  { email: 'customer@wasac.local', password: 'Customer@1234', full_name: 'Test Customer', role: 'customer' },
];

async function getOrCreateAuthUser(supabase, user) {
  const email = user.email.trim().toLowerCase();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: user.password,
    email_confirm: true,
  });

  if (!authError) return authData.user;

  if (!authError.message?.toLowerCase().includes('already been registered')) {
    throw new Error(authError.message);
  }

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw new Error(listError.message);

  const existing = listed?.users?.find((u) => (u.email || '').toLowerCase() === email);
  if (!existing) {
    throw new Error(`Auth user exists for ${email} but could not be resolved from listUsers.`);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
    password: user.password,
    email_confirm: true,
  });
  if (updateError) {
    console.warn(`Password refresh failed for ${email}:`, updateError.message);
  }

  return existing;
}

async function run() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRole) {
    console.log('Supabase env not set. Writing dev_seed_users.json with sample credentials.');
    const payload = { createdAt: new Date().toISOString(), users: sampleUsers };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`Wrote ${outPath}`);
    console.log('You can edit .env with real Supabase keys and re-run this script to create users in Supabase.');
    return;
  }

  console.log('Supabase keys found. Attempting to create users in Supabase...');
  const supabase = createClient(supabaseUrl.replace(/\/+$/, ''), serviceRole);

  for (const u of sampleUsers) {
    try {
      console.log(`Creating ${u.email} (${u.role})`);
      const authUser = await getOrCreateAuthUser(supabase, u);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .upsert(
          {
            user_id: authUser.id,
            email: u.email.trim().toLowerCase(),
            username: u.email.trim().toLowerCase(),
            full_name: u.full_name,
            role: u.role,
            account_status: 'approved',
          },
          { onConflict: 'user_id' }
        )
        .select()
        .single();

      if (profileError) {
        console.warn('Profile insert error:', profileError.message);
      } else {
        console.log(`Created profile id=${profile.id} user_id=${profile.user_id}`);
      }

    } catch (err) {
      console.error('Unexpected error:', err.message || err);
    }
  }

  console.log('Done.');
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
