// Netlify Function: get-status (public)
// GET -> { ok:true, closed: boolean } — whether the admin has manually
// switched the live menu to "Closed". Unauthenticated on purpose: the
// menu board itself needs to read this on every page load (and polls it
// periodically) to know whether to show the "We're Closed" popup.
// Fails soft: any error is reported as closed:false so a storage hiccup
// never makes the live menu look closed to customers.

const { getStatus } = require('./lib/status');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const status = await getStatus();
    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'public, max-age=15' },
      body: JSON.stringify({ ok: true, closed: status.closed })
    };
  } catch (err) {
    console.error('get-status: error:', err.message);
    return { statusCode: 200, body: JSON.stringify({ ok: true, closed: false, error: err.message }) };
  }
};
