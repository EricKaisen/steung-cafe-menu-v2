// Netlify Function: admin-login
// POST { password } -> { ok:true, token } on success, 401 on wrong password.
// See lib/admin-auth.js for how the token works. Requires env var
// ADMIN_PASSWORD to be set (Site settings -> Environment variables).

const { checkPassword, issueToken } = require('./lib/admin-auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  let ok;
  try {
    ok = checkPassword(payload.password);
  } catch (err) {
    console.error('admin-login: config error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured with an admin password' }) };
  }

  if (!ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect password' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, token: issueToken() }) };
};
