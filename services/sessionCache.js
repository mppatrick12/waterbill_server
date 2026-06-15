/**
 * In-memory cache for active water sessions.
 * Avoids Supabase round-trips for hot-path polling (getSessionById)
 * and for MQTT card-tap lookups.
 */

const store        = new Map(); // sessionId  -> session object
const cardIndex    = new Map(); // cardId     -> sessionId  (active sessions only)
const cardDataCache = new Map();// rfid_uid   -> card object (short TTL)

const TTL_MS       = 30 * 60 * 1000; // 30 min safety eviction for sessions
const CARD_TTL_MS  =  5 * 60 * 1000; // 5 min for card data

// ── Session cache ─────────────────────────────────────────────────────────────

export function cacheSession(session) {
  if (!session?.id) return;
  store.set(session.id, { ...session, _cachedAt: Date.now() });
  if (session.card_id) cardIndex.set(session.card_id, session.id);
}

export function updateCachedSession(sessionId, updates) {
  const existing = store.get(sessionId);
  if (existing) {
    store.set(sessionId, { ...existing, ...updates, _cachedAt: Date.now() });
  }
}

export function getCachedSession(sessionId) {
  const entry = store.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry._cachedAt > TTL_MS) { store.delete(sessionId); return null; }
  return entry;
}

/** Find the active session for a given card_id without hitting Supabase. */
export function getActiveSessionByCardId(cardId) {
  const sessionId = cardIndex.get(cardId);
  if (!sessionId) return null;
  return getCachedSession(sessionId);
}

export function evictSession(sessionId) {
  const session = store.get(sessionId);
  if (session?.card_id) cardIndex.delete(session.card_id);
  store.delete(sessionId);
}

// ── Card data mini-cache ──────────────────────────────────────────────────────

export function cacheCardData(rfidUid, cardObj) {
  if (!rfidUid || !cardObj) return;
  cardDataCache.set(String(rfidUid), { ...cardObj, _cachedAt: Date.now() });
}

export function getCachedCardData(rfidUid) {
  const entry = cardDataCache.get(String(rfidUid));
  if (!entry) return null;
  if (Date.now() - entry._cachedAt > CARD_TTL_MS) { cardDataCache.delete(String(rfidUid)); return null; }
  return entry;
}

export function invalidateCardData(rfidUid) {
  cardDataCache.delete(String(rfidUid));
}
