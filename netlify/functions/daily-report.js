// Netlify Scheduled Function: daily-report
// Runs automatically once a day at 5pm (Phnom Penh time) and posts a sales
// report to the same Telegram channel that orders go to. On Sundays it also
// sends a 7-day weekly report, and on the 1st of each month it sends a
// report for the just-finished calendar month. Reads order history from
// Google Sheets (logged there by send-order.js) — see
// netlify/functions/lib/google-sheets.js for the required GOOGLE_* env
// vars and one-time setup.

const { getAllOrders, rewriteOrders } = require('./lib/google-sheets');

const CATEGORY_LABELS = {
  grilled: 'អាំង',
  soft: 'ភេសជ្ជៈ',
  beer: 'ស្រាបៀរ',
  alcohol: 'ស្រា',
  hot: 'ភេសជ្ជៈក្ដៅ',
  frappe: 'ភេសជ្ជៈក្រឡុក',
  iced: 'ភេសជ្ជៈត្រជាក់',
  cream: 'ភេសជ្ជៈគ្រីម'
};

function formatRiel(n) {
  return Math.round(n || 0).toLocaleString('en-US') + '\u17DB'; // ៛
}

function phnomPenhDateKey(isoString) {
  const d = new Date(isoString);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d); // -> YYYY-MM-DD
}

function phnomPenhWeekday(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Phnom_Penh', weekday: 'short' }).format(date);
}

function phnomPenhDayOfMonth(date) {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Phnom_Penh', day: 'numeric' }).format(date), 10);
}

function phnomPenhTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Phnom_Penh'
  });
}

async function sendTelegramMessage(token, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    });
    const data = await res.json();
    if (!data.ok) console.error('daily-report: Telegram rejected message:', JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('daily-report: failed to reach Telegram:', err.message);
    return null;
  }
}

function buildSummary(orders, title) {
  const orderCount = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

  const categoryTotals = {};
  const itemTotals = {};

  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const cat = it.cat || 'other';
      const lineTotal = (it.price || 0) * (it.qty || 0);
      categoryTotals[cat] = (categoryTotals[cat] || 0) + lineTotal;

      const itemKey = `${it.cat || ''}|${it.km || it.en || 'មិនស្គាល់'}`;
      if (!itemTotals[itemKey]) itemTotals[itemKey] = { label: it.km || it.en || 'មិនស្គាល់', qty: 0, revenue: 0 };
      itemTotals[itemKey].qty += (it.qty || 0);
      itemTotals[itemKey].revenue += lineTotal;
    });
  });

  const catLines = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, total]) => `  \u2022 ${CATEGORY_LABELS[cat] || cat}: ${formatRiel(total)}`);

  const topItems = Object.values(itemTotals)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)
    .map((it, i) => `  ${i + 1}. ${it.label} \u00d7 ${it.qty} (${formatRiel(it.revenue)})`);

  return [
    `\uD83D\uDCCA ${title}`,
    'ស្ទឹងកាហ្វេ',
    '\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014',
    `ការកម្ម៉ង់សរុប: ${orderCount}`,
    `ចំណូលសរុប: ${formatRiel(totalRevenue)}`,
    '',
    'តាមប្រភេទ:',
    ...(catLines.length ? catLines : ['  (មិនមានការលក់)']),
    '',
    'ទំនិញលក់ដាច់បំផុត:',
    ...(topItems.length ? topItems : ['  (មិនមានការលក់)'])
  ].join('\n');
}

function buildOrderListMessages(orders, headerText) {
  if (!orders.length) return [`${headerText}\n(មិនមានការកម្ម៉ង់)`];

  const lines = orders.map(o => {
    const t = phnomPenhTime(o.dateISO);
    const name = o.customerName || 'មិនបានបញ្ជាក់';
    return `${t} \u2014 ${name} \u2014 ${formatRiel(o.total)}`;
  });

  // Keep each Telegram message safely under the 4096-char limit.
  const messages = [];
  let current = [headerText, ''];
  let currentLen = current.join('\n').length;

  for (const line of lines) {
    if (currentLen + line.length + 1 > 3500) {
      messages.push(current.join('\n'));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length) messages.push(current.join('\n'));
  return messages;
}

exports.handler = async function () {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHANNEL_ID || '').trim();

  if (!token || !chatId) {
    console.error('daily-report: missing Telegram env vars');
    return { statusCode: 500, body: 'Missing Telegram credentials' };
  }

  let allOrders = [];
  try {
    allOrders = await getAllOrders();
  } catch (err) {
    console.error('daily-report: failed to read orders from Google Sheets:', err.message);
    return { statusCode: 500, body: 'Failed to read order log' };
  }

  const now = new Date();

  // Report on the previous complete calendar day (Phnom Penh time), not
  // "today so far" — even at 5pm the café may still be open for the
  // evening, so today's orders aren't final yet.
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const reportDateKey = phnomPenhDateKey(yesterday.toISOString());
  const reportDayOrders = allOrders.filter(o => phnomPenhDateKey(o.dateISO) === reportDateKey);

  // Daily summary + full order list
  await sendTelegramMessage(token, chatId, buildSummary(reportDayOrders, `របាយការណ៍ប្រចាំថ្ងៃ \u2014 ${reportDateKey}`));
  for (const msg of buildOrderListMessages(reportDayOrders, `\uD83E\uDDFE បញ្ជីកម្ម៉ង់ \u2014 ${reportDateKey}`)) {
    await sendTelegramMessage(token, chatId, msg);
  }

  // Weekly summary, only on Sundays (Phnom Penh time) — covers the 7
  // complete days ending yesterday, matching the daily report's window.
  if (phnomPenhWeekday(now) === 'Sun') {
    const weekStart = new Date(yesterday.getTime() - 6 * 24 * 60 * 60 * 1000);
    const weekStartKey = phnomPenhDateKey(weekStart.toISOString());
    const weekOrders = allOrders.filter(o => {
      const key = phnomPenhDateKey(o.dateISO);
      return key >= weekStartKey && key <= reportDateKey;
    });
    await sendTelegramMessage(token, chatId, buildSummary(weekOrders, `របាយការណ៍ប្រចាំសប្តាហ៍ \u2014 ${weekStartKey} ដល់ ${reportDateKey}`));
  }

  // Monthly summary, only on the 1st of the month (Phnom Penh time) —
  // "yesterday" is then the last day of the just-finished calendar month,
  // so it covers that whole month.
  if (phnomPenhDayOfMonth(now) === 1) {
    const [y, m] = reportDateKey.split('-');
    const monthStartKey = `${y}-${m}-01`;
    const monthOrders = allOrders.filter(o => {
      const key = phnomPenhDateKey(o.dateISO);
      return key >= monthStartKey && key <= reportDateKey;
    });
    await sendTelegramMessage(token, chatId, buildSummary(monthOrders, `របាយការណ៍ប្រចាំខែ \u2014 ${monthStartKey} ដល់ ${reportDateKey}`));
  }

  // Trim history to the last 90 days so the sheet doesn't grow forever
  try {
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const trimmed = allOrders.filter(o => new Date(o.dateISO) >= ninetyDaysAgo);
    if (trimmed.length !== allOrders.length) {
      await rewriteOrders(trimmed);
    }
  } catch (err) {
    console.error('daily-report: failed to trim order history:', err.message);
  }

  return { statusCode: 200, body: 'Report sent' };
};
