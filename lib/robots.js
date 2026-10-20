// Parser de robots.txt (RFC 9309): grupos por user-agent, regra mais específica vence, empate = allow.

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let lastWasRule = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'user-agent') {
      if (!cur || lastWasRule) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasRule = false;
    } else if (field === 'allow' || field === 'disallow') {
      if (!cur) continue;
      lastWasRule = true;
      if (value === '' && field === 'disallow') continue; // "Disallow:" vazio = tudo liberado
      cur.rules.push({ type: field, path: value });
    } else if (field === 'sitemap') {
      if (value) sitemaps.push(value);
    }
  }
  return { groups, sitemaps };
}

/** Regras do grupo que vale para o token de user-agent (ex.: "googlebot"); cai em "*". */
export function rulesFor(parsed, uaToken) {
  const ua = String(uaToken).toLowerCase();
  const exact = parsed.groups.filter((g) => g.agents.includes(ua));
  const groups = exact.length ? exact : parsed.groups.filter((g) => g.agents.includes('*'));
  return { matched: exact.length ? ua : groups.length ? '*' : null, rules: groups.flatMap((g) => g.rules) };
}

function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function isAllowed(parsed, uaToken, pathWithQuery) {
  const { rules, matched } = rulesFor(parsed, uaToken);
  let best = null;
  for (const r of rules) {
    if (!toRegex(r.path).test(pathWithQuery)) continue;
    const len = r.path.replace(/\*/g, '').length;
    if (!best || len > best.len || (len === best.len && r.type === 'allow')) best = { ...r, len };
  }
  return { allowed: !best || best.type === 'allow', rule: best, matched };
}
