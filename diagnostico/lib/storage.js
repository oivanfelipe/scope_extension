// Histórico por cliente, só neste navegador (chrome.storage.local).
const KEY = 'history';
const MAX_ENTRIES = 20;

async function readAll() {
  try { return (await chrome.storage.local.get(KEY))[KEY] || {}; } catch { return {}; }
}

export async function loadHost(host) {
  return (await readAll())[host] || { client: '', entries: [] };
}

export async function saveClient(host, client) {
  const all = await readAll();
  all[host] = { ...(all[host] || { entries: [] }), client };
  await chrome.storage.local.set({ [KEY]: all });
}

/** entry: { ts, url, ok, total, speedMs, items: {id: status} } */
export async function addEntry(host, entry) {
  const all = await readAll();
  const cur = all[host] || { client: '', entries: [] };
  cur.entries = [entry, ...cur.entries].slice(0, MAX_ENTRIES);
  all[host] = cur;
  await chrome.storage.local.set({ [KEY]: all });
  return cur;
}
