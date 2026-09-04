// Netlify Function: admin-orders (admin only)
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD -> { ok:true, orders, summary }
// Both params optional; omitted = all history on file (daily-report.js
// trims this to the last 90 days). Dates are compared as Phnom Penh
// calendar days, inclusive, matching daily-report.js's own reports.

const { getAllOrders } = require('./lib/google-sheets');
const { isAuthorized, unauthorizedResponse } = require('./lib/admin-auth');

const CATEGORY_LABELS = {
  grilled: 'អាំង', soft: 'ភេសជ្ជៈ', beer: 'ស្រាបៀរ', alcohol: 'ស្រា',
  hot: 'ភេសជ្ជៈក្ដៅ', frappe: 'ភេសជ្ជៈក្រឡុក', iced: 'ភេសជ្ជៈត្រជាក់', cream: 'ភេសជ្ជៈគ្រីម'
};

function phnomPenhDateKey(isoString) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(isoString));
}

function buildSummary(orders) {
  const orderCount = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

  const categoryTotals = {};
  const itemTotals = {};

  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const cat = it.cat || 'other';
      const lineTotal = (it.price || 0) * (it.qty || 0);
      categoryTotals[cat] = (categoryTotals[cat] || 0) + lineTotal;

      const key = `${it.cat || ''}|${it.km || it.en || 'unknown'}`;
      if (!itemTotals[key]) itemTotals[key] = { label: it.km || it.en || 'Unknown', cat, qty: 0, revenue: 0 };
      itemTotals[key].qty += (it.qty || 0);
      itemTotals[key].revenue += lineTotal;
    });
  });

  const byCategory = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, revenue]) => ({ cat, label: CATEGORY_LABELS[cat] || cat, revenue }));

  const topItems = Object.values(itemTotals).sort((a, b) => b.qty - a.qty).slice(0, 10);

  return { orderCount, totalRevenue, byCategory, topItems };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  const params = event.queryStringParameters || {};
  const from = params.from || '';
  const to = params.to || '';

  try {
    let orders = await getAllOrders();
    if (from) orders = orders.filter(o => phnomPenhDateKey(o.dateISO) >= from);
    if (to) orders = orders.filter(o => phnomPenhDateKey(o.dateISO) <= to);
    orders.sort((a, b) => (b.dateISO || '').localeCompare(a.dateISO || ''));

    return { statusCode: 200, body: JSON.stringify({ ok: true, orders, summary: buildSummary(orders) }) };
  } catch (err) {
    console.error('admin-orders: error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
