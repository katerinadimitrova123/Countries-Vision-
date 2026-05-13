import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const PLAYER_ID_KEY = 'countries-vision:player-id';
const PLAYER_NAME_KEY = 'countries-vision:player-name';

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getPlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function getStoredName() {
  return localStorage.getItem(PLAYER_NAME_KEY) || '';
}

export function setStoredName(name) {
  localStorage.setItem(PLAYER_NAME_KEY, name);
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// Upsert by id. First call inserts; subsequent calls update (RLS only allows
// updates to a higher score).
export async function submitScore(name, score) {
  if (!isConfigured()) return { ok: false, reason: 'not-configured' };
  const id = getPlayerId();
  const trimmed = String(name || '').trim().slice(0, 24);
  if (!trimmed) return { ok: false, reason: 'empty-name' };

  setStoredName(trimmed);

  const url = `${SUPABASE_URL}/rest/v1/leaderboard?on_conflict=id`;
  const body = JSON.stringify([{
    id,
    name: trimmed,
    score,
    updated_at: new Date().toISOString(),
  }]);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[leaderboard] submit failed', res.status, text);
      return { ok: false, reason: 'http-' + res.status };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[leaderboard] submit error', err);
    return { ok: false, reason: 'network' };
  }
}

// Returns the worldwide rank for a given score (1 = best).
export async function fetchRank(score) {
  if (!isConfigured()) return null;
  const url = `${SUPABASE_URL}/rest/v1/leaderboard?select=id&score=gt.${encodeURIComponent(score)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: headers({ Prefer: 'count=exact', Range: '0-0' }),
    });
    if (!res.ok) return null;
    const range = res.headers.get('content-range') || '';
    const total = parseInt(range.split('/').pop(), 10);
    if (!Number.isFinite(total)) return null;
    return total + 1;
  } catch (err) {
    console.warn('[leaderboard] rank error', err);
    return null;
  }
}

export async function fetchTop(limit = 100) {
  if (!isConfigured()) return [];
  const url = `${SUPABASE_URL}/rest/v1/leaderboard?select=name,score,updated_at&order=score.desc,updated_at.asc&limit=${limit}`;
  try {
    const res = await fetch(url, { method: 'GET', headers: headers() });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.warn('[leaderboard] top error', err);
    return [];
  }
}

export function leaderboardAvailable() {
  return isConfigured();
}
