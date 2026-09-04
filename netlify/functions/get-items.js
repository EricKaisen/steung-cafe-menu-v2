// Netlify Function: get-items (public)
// GET -> { ok:true, items: [...] } — only active items, for the live menu
// page to render. Unauthenticated on purpose: this is the same menu data
// that was previously hardcoded directly into index.html's source.
// Returns items:[] (not an error) if the Items sheet tab is empty/missing
// so the page can fall back to its built-in default menu.

const { getAllItems } = require('./lib/google-sheets');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const items = (await getAllItems()).filter(it => it.active !== false);
    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'public, max-age=30' },
      body: JSON.stringify({ ok: true, items })
    };
  } catch (err) {
    console.error('get-items: error:', err.message);
    // Fail soft: an empty list tells index.html to use its built-in
    // fallback menu rather than showing a broken page.
    return { statusCode: 200, body: JSON.stringify({ ok: true, items: [], error: err.message }) };
  }
};
