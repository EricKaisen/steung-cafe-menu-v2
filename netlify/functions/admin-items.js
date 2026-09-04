// Netlify Function: admin-items (admin only)
// GET            -> list every item (including inactive ones)
// POST   {item}  -> create a new item, returns it with a generated id
// PUT    {item}  -> update an existing item (matched by id)
// DELETE ?id=... -> remove an item
//
// Backed by the "Items" tab in the same Google Sheet used for order
// history — see lib/google-sheets.js for setup. All writes are
// read-all/rewrite-all since Sheets rows aren't reliably addressable by
// row number once items get added/removed.

const { isAuthorized, unauthorizedResponse } = require('./lib/admin-auth');
const { getAllItems, appendItem, rewriteItems, getAllCategories } = require('./lib/google-sheets');

// Fallback list, only used if the Categories sheet tab hasn't been set up
// yet (see getValidCategoryIds below) so item creation doesn't hard-fail
// on a fresh install before the admin has visited the Categories panel.
const FALLBACK_CATEGORIES = ['grilled', 'soft', 'beer', 'alcohol', 'hot', 'frappe', 'iced', 'cream'];

// Categories are admin-editable (see admin-categories.js), so the set of
// valid ids can't be a fixed list — it has to reflect whatever the admin
// has actually created. Falls back to FALLBACK_CATEGORIES only if the
// Categories tab is empty/missing.
async function getValidCategoryIds() {
  try {
    const categories = await getAllCategories();
    if (categories.length) return categories.map(c => c.id);
  } catch (err) {
    console.warn('admin-items: could not load categories, using fallback list:', err.message);
  }
  return FALLBACK_CATEGORIES;
}

function validateItem(it, validCategoryIds) {
  if (!it || typeof it !== 'object') return 'Missing item body';
  if (!it.km && !it.en) return 'Item needs at least a Khmer or English name';
  if (!it.cat || !validCategoryIds.includes(it.cat)) return `cat must be one of: ${validCategoryIds.join(', ')}`;
  if (!it.price || typeof it.price !== 'string') return 'price is required (e.g. "6,000\u17DB")';
  return null;
}

function genId() {
  return `itm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

exports.handler = async function (event) {
  if (!isAuthorized(event)) return unauthorizedResponse();

  try {
    if (event.httpMethod === 'GET') {
      const items = await getAllItems();
      return { statusCode: 200, body: JSON.stringify({ ok: true, items }) };
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const err = validateItem(payload, await getValidCategoryIds());
      if (err) return { statusCode: 400, body: JSON.stringify({ error: err }) };

      const item = {
        id: genId(),
        num: Number(payload.num) || 0,
        cat: payload.cat,
        km: payload.km || '',
        en: payload.en || '',
        price: payload.price,
        popular: !!payload.popular,
        img: payload.img || '',
        active: payload.active !== false
      };
      await appendItem(item);
      return { statusCode: 200, body: JSON.stringify({ ok: true, item }) };
    }

    if (event.httpMethod === 'PUT') {
      const payload = JSON.parse(event.body || '{}');
      if (!payload.id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
      const err = validateItem(payload, await getValidCategoryIds());
      if (err) return { statusCode: 400, body: JSON.stringify({ error: err }) };

      const items = await getAllItems();
      const idx = items.findIndex(it => it.id === payload.id);
      if (idx === -1) return { statusCode: 404, body: JSON.stringify({ error: 'Item not found' }) };

      const updated = {
        id: payload.id,
        num: Number(payload.num) || 0,
        cat: payload.cat,
        km: payload.km || '',
        en: payload.en || '',
        price: payload.price,
        popular: !!payload.popular,
        img: payload.img || items[idx].img || '',
        active: payload.active !== false
      };
      items[idx] = updated;
      await rewriteItems(items);
      return { statusCode: 200, body: JSON.stringify({ ok: true, item: updated }) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

      const items = await getAllItems();
      const next = items.filter(it => it.id !== id);
      if (next.length === items.length) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Item not found' }) };
      }
      await rewriteItems(next);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('admin-items: error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
