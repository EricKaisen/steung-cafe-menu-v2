// Shared helper for storing admin-uploaded product photos in Netlify Blobs.
//
// Inside a deployed Netlify Function, @netlify/blobs auto-detects the site
// and an execution-scoped token from the environment, so no config is
// normally needed. NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN (already set as
// env vars on this site) are used as an explicit fallback for contexts
// where that auto-detection doesn't apply (e.g. testing outside a deployed
// function), matching the manual-config mode @netlify/blobs supports.

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'menu-images';

function store() {
  const siteID = (process.env.NETLIFY_SITE_ID || '').trim();
  const token = (process.env.NETLIFY_BLOBS_TOKEN || '').trim();
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token });
  }
  return getStore(STORE_NAME);
}

// Saves a raster image and returns the key it was stored under.
async function saveImage(key, buffer, contentType) {
  await store().set(key, buffer, { metadata: { contentType } });
  return key;
}

// Returns { buffer, contentType } or null if not found.
async function getImage(key) {
  const s = store();
  const entry = await s.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!entry) return null;
  return {
    buffer: Buffer.from(entry.data),
    contentType: (entry.metadata && entry.metadata.contentType) || 'application/octet-stream'
  };
}

async function deleteImage(key) {
  await store().delete(key);
}

module.exports = { saveImage, getImage, deleteImage };
