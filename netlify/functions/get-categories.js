// Netlify Function: get-categories (public)
// GET -> { ok:true, categories: [...] } — only active categories, for the
// live menu page to render. Unauthenticated on purpose, same reasoning as
// get-items.js. Returns categories:[] (not an error) if the Categories
// sheet tab is empty/missing so the page can fall back to its built-in
// default category list.

const { getAllCategories } = require('./lib/google-sheets');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const categories = (await getAllCategories()).filter(c => c.active !== false);
    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'public, max-age=30' },
      body: JSON.stringify({ ok: true, categories })
    };
  } catch (err) {
    console.error('get-categories: error:', err.message);
    // Fail soft: an empty list tells index.html to use its built-in
    // fallback categories rather than showing a broken page.
    return { statusCode: 200, body: JSON.stringify({ ok: true, categories: [], error: err.message }) };
  }
};
