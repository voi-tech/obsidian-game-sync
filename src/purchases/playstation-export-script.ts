/**
 * Script the user pastes into the browser console on Sony's transaction history page.
 *
 * Sony gives no API token for transaction history to third-party apps, so the page itself has to make the
 * request. The script listens to the page's own call to `/api/transactions/v2/history`, repeats it page by
 * page back to 2010 (as Sony's site does when you widen the date range), and copies a CSV with only
 * date, product, SKU, type, price and currency to the clipboard. Payment method, billing details and
 * IP address are never read into the CSV. Nothing is sent anywhere except Sony's own API.
 *
 * Kept as plain ES2020 in a raw string so it runs unchanged in any browser console.
 */
export const PLAYSTATION_EXPORT_SCRIPT = String.raw`(async () => {
  const LOG = (message) => console.log('%c[Game Sync] ' + message, 'color:#0070d1;font-weight:bold');
  const frames = Array.from(document.querySelectorAll('iframe')).map((frame) => frame.src || '');
  if (location.hostname !== 'transact.playstation.com' && frames.some((src) => src.includes('transact.playstation.com'))) {
    LOG('Historia jest w osadzonej ramce. Nad konsola zmien kontekst z "top" na "transact.playstation.com" i wklej skrypt jeszcze raz.');
    return;
  }
  const isHistory = (url) => typeof url === 'string' && /\/transactions\/v\d+\/history|\/transact\/transaction/.test(url);
  let captured;
  const remember = (url, headers) => { if (!captured && isHistory(url)) captured = { url: String(url), headers }; };
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const headers = new Headers((init && init.headers) || (input && input.headers) || {});
      remember(url, Object.fromEntries(headers.entries()));
    } catch (error) { /* keep the page working */ }
    return originalFetch.apply(this, arguments);
  };
  const open = XMLHttpRequest.prototype.open;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__gsUrl = url; this.__gsHeaders = {}; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) { if (this.__gsHeaders) this.__gsHeaders[name.toLowerCase()] = value; return setHeader.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { remember(this.__gsUrl, this.__gsHeaders || {}); return send.apply(this, arguments); };
  const restore = () => { window.fetch = originalFetch; XMLHttpRequest.prototype.open = open; XMLHttpRequest.prototype.setRequestHeader = setHeader; XMLHttpRequest.prototype.send = send; };

  LOG('Gotowe. Teraz zmien zakres dat w historii transakcji (np. wybierz inny okres), zeby strona pobrala dane. Czekam do 3 minut...');
  const deadline = Date.now() + 180000;
  while (!captured && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  restore();
  if (!captured) { LOG('Strona nie pobrala historii w ciagu 3 minut. Odswiez strone i sprobuj ponownie.'); return; }

  const sonyDate = (date) => date.toISOString().replace('Z', '+0000');
  const headers = {};
  for (const [name, value] of Object.entries(captured.headers)) if (/^(authorization|accept|content-type|x-psn-.*)$/i.test(name)) headers[name] = value;
  const transactions = [];
  let endDate = sonyDate(new Date(Date.now() + 86400000));
  let previousEnd;
  for (let page = 0; page < 100 && endDate && endDate !== previousEnd; page += 1) {
    previousEnd = endDate;
    const url = new URL(captured.url, location.href);
    url.searchParams.set('startDate', sonyDate(new Date(Date.UTC(2010, 0, 1))));
    url.searchParams.set('endDate', endDate);
    url.searchParams.set('limit', '200');
    const response = await originalFetch(url.toString(), { headers, credentials: 'include' });
    if (!response.ok) { LOG('Sony odpowiedzialo bledem ' + response.status + ' na stronie ' + (page + 1) + '. Zapisuje to, co juz pobrano.'); break; }
    const body = await response.json();
    if (!Array.isArray(body.transactions)) { LOG('Nieznany format odpowiedzi (' + new URL(captured.url, location.href).pathname + ', klucze: ' + Object.keys(body).join(', ') + '). Przeslij ten komunikat autorowi wtyczki.'); break; }
    const batch = body.transactions;
    transactions.push(...batch);
    LOG('Pobrano transakcji: ' + transactions.length);
    if (!body.hasMore || batch.length === 0) break;
    endDate = body.nextEndDate;
  }

  const cell = (value) => { const text = value === undefined || value === null ? '' : String(value); return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; };
  const money = (minor) => { const value = Number(minor && typeof minor === 'object' ? minor.value : minor); return Number.isFinite(value) ? (value / 100).toFixed(2) : ''; };
  const lines = ['date,transaction_id,type,product_name,sku_id,price,currency'];
  for (const transaction of transactions) {
    const detail = transaction.transactionDetail || {};
    const info = transaction.additionalInfo || {};
    const base = [cell(detail.transactionDate), cell(detail.transactionId)];
    for (const item of info.orderItems || []) lines.push([...base, cell(item.transactionType), cell(item.productName), cell(item.skuId), money(item.totalPrice), cell(transaction.currencyCode)].join(','));
    for (const item of info.refundItems || []) { const value = money(item.total); lines.push([...base, cell(item.transactionType || 'REFUND'), cell(item.productName), '', value === '' ? '' : '-' + value.replace(/^-/, ''), cell(transaction.currencyCode)].join(',')); }
  }
  const csv = lines.join('\n');
  window.__gameSyncPurchasesCsv = csv;
  try {
    if (typeof copy === 'function') copy(csv); else await navigator.clipboard.writeText(csv);
    LOG('Skopiowano ' + (lines.length - 1) + ' pozycji do schowka. W Obsidianie kliknij "Wklej ze schowka" w imporcie zakupow.');
  } catch (error) {
    LOG('Nie udalo sie skopiowac do schowka. Wpisz w konsoli: copy(window.__gameSyncPurchasesCsv)');
  }
})();`;
