// Shared helper for talking to the Google Sheets API using a service
// account (JWT Bearer flow). No external npm dependency — the JWT is
// signed with Node's built-in `crypto` module, so the function bundle
// stays small and there's nothing extra to install.
//
// Required env vars (Site settings -> Environment variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  service account email
//                                 (looks like xxx@xxx.iam.gserviceaccount.com)
//   GOOGLE_PRIVATE_KEY            the service account's private key (PEM),
//                                 pasted with literal \n for newlines, e.g.
//                                 "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
//   GOOGLE_SHEET_ID               the spreadsheet ID (the long id in its URL)
//
// Setup (one-time):
//   1. Google Cloud Console -> create a project (or use an existing one)
//   2. Enable the "Google Sheets API"
//   3. Create a Service Account, then create a JSON key for it
//   4. Copy `client_email` -> GOOGLE_SERVICE_ACCOUNT_EMAIL
//      Copy `private_key`  -> GOOGLE_PRIVATE_KEY
//   5. Create a Google Sheet, add a tab named exactly "Orders" with header
//      row: id | dateISO | customerName | contact | total | items
//   6. Also add a tab named exactly "Items" with header row:
//      id | num | cat | km | en | price | popular | img | active
//      (the admin dashboard reads/writes this tab; it's fine to leave it
//      empty besides the header — the admin page can populate it, and the
//      public menu falls back to its built-in item list until it does)
//   7. Share that Sheet with the service account email as Editor
//   8. Copy the Sheet ID from its URL -> GOOGLE_SHEET_ID

const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEET_TAB = 'Orders';
const ITEMS_TAB = 'Items';

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';

  if (!email || !rawKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars');
  }

  let privateKey = rawKey.trim();

  // Strip a single layer of wrapping quotes, in case the whole value was
  // pasted including the quote characters (a common copy/paste mistake).
  if (
    (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
    (privateKey.startsWith("'") && privateKey.endsWith("'"))
  ) {
    privateKey = privateKey.slice(1, -1).trim();
  }
  // Normalize escaped newlines (\n as two characters) into real newlines,
  // and normalize any Windows-style \r\n into plain \n.
  privateKey = privateKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

  if (!privateKey.includes('BEGIN PRIVATE KEY') && !privateKey.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY does not look like a valid PEM key (missing "BEGIN PRIVATE KEY" header). ' +
      'Check that the full private_key value from the service account JSON was pasted, without added quotes.'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('Failed to get Google access token: ' + JSON.stringify(data));
  }
  return data.access_token;
}

function requireSheetId() {
  const sheetId = (process.env.GOOGLE_SHEET_ID || '').trim();
  if (!sheetId) throw new Error('Missing GOOGLE_SHEET_ID env var');
  return sheetId;
}

async function appendOrderRow(order) {
  const sheetId = requireSheetId();
  const token = await getAccessToken();

  const row = [
    order.id,
    order.dateISO,
    order.customerName || '',
    order.contact || '',
    order.total || 0,
    JSON.stringify(order.items || [])
  ];

  const range = encodeURIComponent(`${SHEET_TAB}!A:F`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Sheets append failed: ' + JSON.stringify(data));
  return data;
}

async function getAllOrders() {
  const sheetId = requireSheetId();
  const token = await getAccessToken();

  const range = encodeURIComponent(`${SHEET_TAB}!A2:F`); // skip header row
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error('Sheets read failed: ' + JSON.stringify(data));

  const rows = data.values || [];
  return rows
    .filter(r => r && r[0]) // skip blank rows
    .map(r => {
      let items = [];
      try { items = JSON.parse(r[5] || '[]'); } catch (e) { items = []; }
      return {
        id: r[0] || '',
        dateISO: r[1] || '',
        customerName: r[2] || '',
        contact: r[3] || '',
        total: Number(r[4]) || 0,
        items
      };
    });
}

// Replaces all data rows (keeps the header) with the given list of orders.
// Used to trim old history so the sheet doesn't grow forever.
async function rewriteOrders(orders) {
  const sheetId = requireSheetId();
  const token = await getAccessToken();

  const clearRange = encodeURIComponent(`${SHEET_TAB}!A2:F`);
  const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${clearRange}:clear`;
  const clearRes = await fetch(clearUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!clearRes.ok) throw new Error('Sheets clear failed: ' + JSON.stringify(await clearRes.json()));

  if (!orders.length) return;

  const values = orders.map(o => [
    o.id, o.dateISO, o.customerName || '', o.contact || '', o.total || 0, JSON.stringify(o.items || [])
  ]);

  const appendRange = encodeURIComponent(`${SHEET_TAB}!A2`);
  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${appendRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const appendRes = await fetch(appendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  if (!appendRes.ok) throw new Error('Sheets rewrite-append failed: ' + JSON.stringify(await appendRes.json()));
}

/* ================= ITEMS (menu) — used by the admin dashboard ================= */

function rowToItem(r) {
  return {
    id: r[0] || '',
    num: Number(r[1]) || 0,
    cat: r[2] || '',
    km: r[3] || '',
    en: r[4] || '',
    price: r[5] || '',
    popular: String(r[6]).toLowerCase() === 'true',
    img: r[7] || '',
    active: r[8] === '' || r[8] === undefined ? true : String(r[8]).toLowerCase() !== 'false'
  };
}

function itemToRow(it) {
  return [
    it.id,
    it.num || 0,
    it.cat || '',
    it.km || '',
    it.en || '',
    it.price || '',
    it.popular ? 'true' : 'false',
    it.img || '',
    it.active === false ? 'false' : 'true'
  ];
}

// Returns every item row from the Items tab, in sheet order. Returns an
// empty array (not an error) if the tab doesn't exist yet or is empty —
// callers should fall back to a built-in default list in that case.
async function getAllItems() {
  const sheetId = requireSheetId();
  const token = await getAccessToken();

  const range = encodeURIComponent(`${ITEMS_TAB}!A2:I`); // skip header row
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) {
    // Tab missing is a common first-run state — treat like "no items yet".
    if (data && data.error && /Unable to parse range/i.test(data.error.message || '')) return [];
    throw new Error('Sheets read failed: ' + JSON.stringify(data));
  }

  const rows = data.values || [];
  return rows.filter(r => r && r[0]).map(rowToItem);
}

async function appendItem(item) {
  const sheetId = requireSheetId();
  const token = await getAccessToken();

  const range = encodeURIComponent(`${ITEMS_TAB}!A:I`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [itemToRow(item)] })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Sheets append failed: ' + JSON.stringify(data));
  return data;
}

// Replaces every row in the Items tab (keeps the header) with the given
// list. Used for update/delete, both of which are implemented as
// "read all, modify in memory, rewrite all" since Sheets rows aren't
// addressable by a stable row number once items get reordered/deleted.
async function rewriteItems(items) {
  const sheetId = requireSheetId();
  const token = await getAccessToken();

  const clearRange = encodeURIComponent(`${ITEMS_TAB}!A2:I`);
  const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${clearRange}:clear`;
  const clearRes = await fetch(clearUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!clearRes.ok) throw new Error('Sheets clear failed: ' + JSON.stringify(await clearRes.json()));

  if (!items.length) return;

  const values = items.map(itemToRow);
  const appendRange = encodeURIComponent(`${ITEMS_TAB}!A2`);
  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${appendRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const appendRes = await fetch(appendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  if (!appendRes.ok) throw new Error('Sheets rewrite-append failed: ' + JSON.stringify(await appendRes.json()));
}

module.exports = {
  appendOrderRow, getAllOrders, rewriteOrders,
  getAllItems, appendItem, rewriteItems
};
