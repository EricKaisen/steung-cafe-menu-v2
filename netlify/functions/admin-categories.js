// Netlify Function: admin-categories (admin only)
// GET             -> list every category (including inactive ones)
// POST   {cat}    -> create a new category, body: { id, km, en, active }
//                    (id is generated client-side in admin.html via
//                    slugifyCatId, so it's supplied here rather than
//                    generated server-side — that keeps the id human
//                    readable, e.g. "desserts" instead of a random string)
// PUT    {cat}    -> update an existing category (matched by id)
// DELETE ?id=...  -> remove a category (blocked if any item still uses it)
//
// Backed by the "Categories" tab in the same Google Sheet used for items
// and order history — see lib/google-sheets.js for setup. All writes are
// read-all/rewrite-all since Sheets rows aren't reliably addressable by
// row number once categories get added/removed.

const { isAuthorized, unauthorizedResponse } = require('./lib/admin-auth');
const { getAllCategories, appendCategory, rewriteCategories, getAllItems } = require('./lib/google-sheets');

function validateCategory(c) {
  if (!c || typeof c !== 'object') return 'Missing category body';
  if (!c.id || typeof c.id !== 'string') return 'id is required';
  if (!c.km && !c.en) return 'Category needs at least a Khmer or English name';
  return null;
}

exports.handler = async function (event) {
  if (!isAuthorized(event)) return unauthorizedResponse();

  try {
    if (event.httpMethod === 'GET') {
      const categories = await getAllCategories();
      return { statusCode: 200, body: JSON.stringify({ ok: true, categories }) };
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const err = validateCategory(payload);
      if (err) return { statusCode: 400, body: JSON.stringify({ error: err }) };

      const existing = await getAllCategories();
      if (existing.some(c => c.id === payload.id)) {
        return { statusCode: 400, body: JSON.stringify({ error: `Category id "${payload.id}" already exists` }) };
      }

      const category = {
        id: payload.id,
        km: payload.km || '',
        en: payload.en || '',
        active: payload.active !== false
      };
      await appendCategory(category);
      return { statusCode: 200, body: JSON.stringify({ ok: true, category }) };
    }

    if (event.httpMethod === 'PUT') {
      const payload = JSON.parse(event.body || '{}');
      if (!payload.id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
      const err = validateCategory(payload);
      if (err) return { statusCode: 400, body: JSON.stringify({ error: err }) };

      const categories = await getAllCategories();
      const idx = categories.findIndex(c => c.id === payload.id);
      if (idx === -1) return { statusCode: 404, body: JSON.stringify({ error: 'Category not found' }) };

      const updated = {
        id: payload.id,
        km: payload.km || '',
        en: payload.en || '',
        active: payload.active !== false
      };
      categories[idx] = updated;
      await rewriteCategories(categories);
      return { statusCode: 200, body: JSON.stringify({ ok: true, category: updated }) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

      const [categories, items] = await Promise.all([getAllCategories(), getAllItems()]);
      if (items.some(it => it.cat === id)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'This category is used by menu items — reassign or delete those items first.' }) };
      }

      const next = categories.filter(c => c.id !== id);
      if (next.length === categories.length) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Category not found' }) };
      }
      await rewriteCategories(next);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('admin-categories: error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
