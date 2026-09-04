// Shared helper for the "menu open/closed" toggle the admin dashboard
// controls. Backed by Netlify Blobs (same mechanism as lib/blobs.js uses
// for photos) — a single small JSON record, no Google Sheets tab needed.

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'site-status';
const KEY = 'menu-status';

function store() {
  const siteID = (process.env.NETLIFY_SITE_ID || '').trim();
  const token = (process.env.NETLIFY_BLOBS_TOKEN || '').trim();
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token });
  }
  return getStore(STORE_NAME);
}

// Returns { closed: boolean, updatedAt: string|null }. Defaults to
// { closed:false } (menu open) if nothing has been set yet, or if the
// blob store can't be reached — a status-store hiccup should never be
// the reason the live menu looks closed.
async function getStatus() {
  try {
    const raw = await store().get(KEY, { type: 'json' });
    if (!raw || typeof raw !== 'object') return { closed: false, updatedAt: null };
    return { closed: !!raw.closed, updatedAt: raw.updatedAt || null };
  } catch (err) {
    console.error('status: getStatus failed, defaulting to open:', err.message);
    return { closed: false, updatedAt: null };
  }
}

async function setStatus(closed) {
  const record = { closed: !!closed, updatedAt: new Date().toISOString() };
  await store().setJSON(KEY, record);
  return record;
}

module.exports = { getStatus, setStatus };
