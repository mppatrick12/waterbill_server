import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** Auth/API need project root URL, not the REST path */
export function normalizeSupabaseUrl(url) {
  if (!url) return '';
  return url
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/, '');
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createUnavailableQuery(message) {
  const result = Promise.resolve({ data: null, error: { message } });
  let proxy;

  proxy = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') return result.then.bind(result);
      if (prop === 'catch') return result.catch.bind(result);
      if (prop === 'finally') return result.finally.bind(result);
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });

  return proxy;
}

export function createUnavailableSupabaseClient(message = 'Supabase environment variables are missing.') {
  const query = createUnavailableQuery(message);

  const auth = {
    getUser: async () => ({
      data: { user: null },
      error: { message },
    }),
  };

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'auth') return auth;
        if (prop === 'from') return () => query;
        if (prop === 'then') return undefined;
        return () => query;
      },
    }
  );
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. API will fail on DB calls.');
} else if (process.env.SUPABASE_URL?.includes('/rest/v1')) {
  console.warn(
    'SUPABASE_URL was corrected (remove /rest/v1). Use: https://YOUR_PROJECT.supabase.co'
  );
}

// TLS: set SUPABASE_INSECURE_SSL=true on Render if Supabase connection fails
const insecureDevSsl =
  process.env.SUPABASE_INSECURE_SSL === 'true' ||
  (process.env.NODE_ENV !== 'production' && process.env.SUPABASE_INSECURE_SSL !== 'false');

if (insecureDevSsl) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : createUnavailableSupabaseClient();

export default supabase;
