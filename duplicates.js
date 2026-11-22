export function duplicatePlan(tabs) {
  const urls = new Map();
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    const url = tab.pendingUrl || tab.url;
    if (!url) continue;
    if (!urls.has(url)) urls.set(url, []);
    urls.get(url).push(tab);
  }
  const groups = [...urls].filter(([, members]) => members.length > 1);
  const close = [];
  const keepIds = new Set();
  for (const [url, members] of groups) {
    const pinned = members.filter(tab => tab.pinned);
    const kept = pinned.length ? pinned : [members.find(tab => tab.active) || members[0]];
    kept.forEach(tab => keepIds.add(tab.id));
    for (const tab of members) if (!keepIds.has(tab.id)) close.push({ id: tab.id, url });
  }
  return { groups, close, keepIds, memberIds: new Set(groups.flatMap(([, members]) => members.map(tab => tab.id))) };
}

export async function closeDuplicates(api, windowId, requested) {
  // Recalculate against current state and restrict to the reviewed IDs and URLs.
  const approved = new Map(requested.map(tab => [tab.id, tab.url]));
  const reviewed = (await api.tabs.query({ windowId })).filter(tab => approved.get(tab.id) === (tab.pendingUrl || tab.url));
  const ids = duplicatePlan(reviewed).close.map(tab => tab.id);
  if (ids.length) await api.tabs.remove(ids);
  return ids.length;
}
