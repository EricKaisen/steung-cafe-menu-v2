// Netlify Function: admin-status (admin only)
// GET             -> { ok:true, closed, updatedAt } current status
// POST {closed}   -> set the status, returns the updated record
//
// This is what the "Close Menu" / "Open Menu" button in admin.html calls.
// The live menu page reads the same flag (read-only) via get-status.js.

const { isAuthorized, unauthorizedResponse } = require('./lib/admin-auth');
const { getStatus, setStatus } = require('./lib/status');

exports.handler = async function (event) {
  if (!isAuthorized(event)) return unauthorizedResponse();

  try {
    if (event.httpMethod === 'GET') {
      const status = await getStatus();
      return { statusCode: 200, body: JSON.stringify({ ok: true, ...status }) };
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      if (typeof payload.closed !== 'boolean') {
        return { statusCode: 400, body: JSON.stringify({ error: '"closed" must be true or false' }) };
      }
      const status = await setStatus(payload.closed);
      return { statusCode: 200, body: JSON.stringify({ ok: true, ...status }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('admin-status: error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
