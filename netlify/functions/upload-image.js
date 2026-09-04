// Netlify Function: upload-image (admin only)
// POST { filename, dataUrl } where dataUrl is a base64 "data:image/..;base64,...."
// string (what <input type=file> + FileReader.readAsDataURL gives you).
// Stores the image in Netlify Blobs and returns { ok:true, url } — url
// points at get-image.js, which is what gets saved as the item's `img`.

const { isAuthorized, unauthorizedResponse } = require('./lib/admin-auth');
const { saveImage } = require('./lib/blobs');

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl : '';
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Expected a base64 data URL in dataUrl' }) };
  }

  const contentType = match[1];
  if (!ALLOWED_TYPES.has(contentType)) {
    return { statusCode: 400, body: JSON.stringify({ error: `Unsupported image type: ${contentType}` }) };
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_BYTES) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Image too large (max 5MB)' }) };
  }
  if (buffer.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Empty image' }) };
  }

  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    await saveImage(key, buffer, contentType);
  } catch (err) {
    console.error('upload-image: save failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to store image: ' + err.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, url: `/.netlify/functions/get-image?key=${encodeURIComponent(key)}` })
  };
};
