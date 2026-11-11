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
const SCRIPT = String.raw`(async () => {
  const MESSAGES = __MESSAGES__;
  const T = (key, values) => MESSAGES[key].replace(/\{(\w+)\}/g, (match, name) => values && name in values ? String(values[name]) : match);
  const LOG = (message) => console.log('%c[Game Sync] ' + message, 'color:#0070d1;font-weight:bold');
  const frames = Array.from(document.querySelectorAll('iframe')).map((frame) => frame.src || '');
  if (location.hostname !== 'transact.playstation.com' && frames.some((src) => src.includes('transact.playstation.com'))) {
    LOG(T('frame'));
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

  LOG(T('waiting'));
  const deadline = Date.now() + 180000;
  while (!captured && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  restore();
  if (!captured) { LOG(T('timeout')); return; }

  const sonyDate = (date) => date.toISOString().replace('Z', '+0000');
  const headers = {};
  for (const [name, value] of Object.entries(captured.headers)) if (/^(authorization|accept|content-type|x-psn-.*)$/i.test(name)) headers[name] = value;
  const transactions = [];
  let endDate = sonyDate(new Date(Date.now() + 86400000));
  let previousEnd;
  let complete = false;
  for (let page = 0; page < 100 && endDate && endDate !== previousEnd; page += 1) {
    previousEnd = endDate;
    const url = new URL(captured.url, location.href);
    url.searchParams.set('startDate', sonyDate(new Date(Date.UTC(2010, 0, 1))));
    url.searchParams.set('endDate', endDate);
    url.searchParams.set('limit', '200');
    const response = await originalFetch(url.toString(), { headers, credentials: 'include' });
    if (!response.ok) { LOG(T('httpError', { status: response.status, page: page + 1 })); break; }
    const body = await response.json();
    if (!Array.isArray(body.transactions)) { LOG(T('unknownFormat', { path: new URL(captured.url, location.href).pathname, keys: Object.keys(body).join(', ') })); break; }
    const batch = body.transactions;
    transactions.push(...batch);
    LOG(T('progress', { count: transactions.length }));
    if (!body.hasMore || batch.length === 0) { complete = true; break; }
    endDate = body.nextEndDate;
  }
  // Stopping on an error, the page limit or a repeated end date leaves part of the history out.
  if (!complete && transactions.length > 0) LOG(T('pageLimit'));

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
  if (!complete) { LOG(T('incomplete', { count: lines.length - 1 })); return; }
  try {
    if (typeof copy === 'function') copy(csv); else await navigator.clipboard.writeText(csv);
    LOG(T('copied', { count: lines.length - 1 }));
  } catch (error) {
    LOG(T('copyFailed'));
  }
})();`;

const MESSAGES = {
	pl: {
	 "frame": "Historia jest w osadzonej ramce. Nad konsolą zmień kontekst z \"top\" na \"transact.playstation.com\" i wklej skrypt jeszcze raz.",
	 "waiting": "Gotowe. Teraz zmień zakres dat w historii transakcji (np. wybierz inny okres), żeby strona pobrała dane. Czekam do 3 minut...",
	 "timeout": "Strona nie pobrała historii w ciągu 3 minut. Odśwież stronę i spróbuj ponownie.",
	 "httpError": "Sony odpowiedziało błędem {status} na stronie {page}. Eksport jest niepełny.",
	 "unknownFormat": "Nieznany format odpowiedzi ({path}, klucze: {keys}). Prześlij ten komunikat autorowi wtyczki.",
	 "progress": "Pobrano transakcji: {count}",
	 "pageLimit": "Osiągnięto limit stron, a Sony ma jeszcze dane. Eksport jest niepełny.",
	 "incomplete": "Nie kopiuję niepełnej historii, bo data pierwszego zakupu mogłaby być błędna. Uruchom skrypt ponownie. Jeśli mimo to chcesz użyć pobranych {count} pozycji, wpisz w konsoli: copy(window.__gameSyncPurchasesCsv)",
	 "copied": "Skopiowano {count} pozycji do schowka. W Obsidianie kliknij \"Wklej ze schowka\" w imporcie zakupów.",
	 "copyFailed": "Nie udało się skopiować do schowka. Wpisz w konsoli: copy(window.__gameSyncPurchasesCsv)"
	},
	en: {
	 "frame": "The history is in an embedded frame. Above the console, switch the context from \"top\" to \"transact.playstation.com\" and paste the script again.",
	 "waiting": "Ready. Now change the date range in the transaction history (for example pick another period) so the page loads data. Waiting up to 3 minutes...",
	 "timeout": "The page did not load the history within 3 minutes. Reload the page and try again.",
	 "httpError": "Sony returned error {status} on page {page}. The export is incomplete.",
	 "unknownFormat": "Unknown response format ({path}, keys: {keys}). Send this message to the plugin author.",
	 "progress": "Transactions downloaded: {count}",
	 "pageLimit": "The page limit was reached while Sony still has data. The export is incomplete.",
	 "incomplete": "An incomplete history is not copied, because the first purchase date could be wrong. Run the script again. To use the {count} downloaded items anyway, type in the console: copy(window.__gameSyncPurchasesCsv)",
	 "copied": "Copied {count} items to the clipboard. In Obsidian, select \"Paste from clipboard\" in the purchase import.",
	 "copyFailed": "Could not copy to the clipboard. Type in the console: copy(window.__gameSyncPurchasesCsv)"
	},
} as const satisfies Record<string, Record<string, string>>;

/** The console script with its messages in the user's language. */
export function playStationExportScript(language: keyof typeof MESSAGES): string {
	return SCRIPT.replace('__MESSAGES__', () => JSON.stringify(MESSAGES[language]));
}
