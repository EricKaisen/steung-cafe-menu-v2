// Netlify Function: send-order
// Receives order text from the menu page and posts it into the Telegram
// channel using the Bot API. The bot token stays private on the server side
// (set as a Netlify environment variable) and is never exposed to the browser.

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

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing order text' }) };
  }

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHANNEL_ID || '').trim();

  if (!token || !chatId) {
    console.error('Missing Telegram env vars. token set:', !!token, 'chatId set:', !!chatId);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured with Telegram credentials' }) };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    const data = await response.json();

    if (!data.ok) {
      console.error('Telegram API rejected message:', JSON.stringify(data));
      return {
        statusCode: 502,
        body: JSON.stringify({ error: data.description || 'Telegram API rejected the message' })
      };
    }

    // Log the order for reporting. This is best-effort: if it fails, the
    // order still succeeded (it's already in Telegram), so we don't fail the request.
    try {
      const { appendOrderRow } = require('./lib/google-sheets');
      await appendOrderRow({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dateISO: new Date().toISOString(),
        customerName: (payload.order && payload.order.customerName) || '',
        contact: (payload.order && payload.order.contact) || '',
        total: (payload.order && typeof payload.order.total === 'number') ? payload.order.total : 0,
        items: (payload.order && Array.isArray(payload.order.items)) ? payload.order.items : []
      });
    } catch (logErr) {
      console.error('Failed to log order for reporting:', logErr.message);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Failed to reach Telegram:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to reach Telegram: ' + err.message }) };
  }
};
