// Netlify Function: get-image (public)
// GET ?key=... -> streams back an image previously stored by upload-image.js.
// Public and unauthenticated on purpose: these are product photos shown on
// the public menu, same as the static files under /asset.

const { getImage } = require('./lib/blobs');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const key = (event.queryStringParameters && event.queryStringParameters.key) || '';
  if (!key) {
    return { statusCode: 400, body: 'Missing key' };
  }

  let entry;
  try {
    entry = await getImage(key);
  } catch (err) {
    console.error('get-image: read failed:', err.message);
    return { statusCode: 500, body: 'Failed to read image' };
  }

  if (!entry) {
    return { statusCode: 404, body: 'Not found' };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': entry.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable'
    },
    body: entry.buffer.toString('base64'),
    isBase64Encoded: true
  };
};
