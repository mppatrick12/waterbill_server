import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFile = path.join(__dirname, '..', '..', 'supabase', 'apply_all_migrations.sql');

function getDatabaseUrl() {
  return (
    process.env.SUPABASE_DB_POOLER_URL ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    ''
  );
}

function createPgClient(databaseUrl) {
  const sslEnabled = process.env.SUPABASE_INSECURE_SSL !== 'false';

  return new Client({
    connectionString: databaseUrl,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  });
}

export async function applyAllMigrations() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.warn('[Migrations] Skipping startup migrations: SUPABASE_DB_POOLER_URL/DATABASE_URL not set.');
    return { applied: false, reason: 'missing_database_url' };
  }

  const sql = await readFile(migrationsFile, 'utf8');
  const client = createPgClient(databaseUrl);

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[Migrations] Applied combined Supabase migration script.');
    return { applied: true };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    throw error;
  } finally {
    await client.end();
  }
}

export async function applyAllMigrationsBestEffort() {
  try {
    return await applyAllMigrations();
  } catch (error) {
    console.warn('[Migrations] Startup migrations failed, continuing to boot API:', error.message);
    return { applied: false, reason: 'migration_failed', error: error.message };
  }
}