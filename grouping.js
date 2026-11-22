import { groupByDomain, domainOf, colorOf } from "./domain.js";

// Keep pinned tabs in place. Reuse only groups containing a single matching domain.
export async function organizeWindow(api, windowId) {
  const initialTabs = await api.tabs.query({ windowId });
  const groups = await api.tabGroups.query({ windowId });
  let domainCount = 0;
  let tabCount = 0;
  let skippedCount = 0;
  for (const [domain, candidates] of groupByDomain(initialTabs.filter(tab => !tab.pinned))) {
    // A page may close or navigate while an asynchronous grouping pass is running.
    const currentTabs = await api.tabs.query({ windowId });
    const candidateIds = new Set(candidates.map(tab => tab.id));
    const members = currentTabs.filter(tab => candidateIds.has(tab.id) && !tab.pinned && domainOf(tab) === domain);
    skippedCount += candidates.length - members.length;
    if (!members.length) continue;
    const reusable = groups.find(group => group.title === domain && currentTabs.some(tab => tab.groupId === group.id) &&
      currentTabs.filter(tab => tab.groupId === group.id).every(tab => !tab.pinned && domainOf(tab) === domain));
    const options = reusable
      ? { groupId: reusable.id, tabIds: members.map(tab => tab.id) }
      : { createProperties: { windowId }, tabIds: members.map(tab => tab.id) };
    let groupId;
    try {
      groupId = await api.tabs.group(options);
    } catch (error) {
      const latest = await api.tabs.query({ windowId });
      const validIds = new Set(latest.filter(tab => !tab.pinned && domainOf(tab) === domain).map(tab => tab.id));
      if (members.every(tab => validIds.has(tab.id))) throw error;
      // The next automatic pass will handle the remaining members after a concurrent close.
      skippedCount += members.length;
      continue;
    }
    await api.tabGroups.update(groupId, { title: domain, color: colorOf(domain) });
    await api.tabGroups.move(groupId, { index: -1 });
    domainCount += 1;
    tabCount += members.length;
  }
  return { domainCount, tabCount, skippedCount, pinnedCount: initialTabs.filter(tab => tab.pinned).length };
}

// Automatic passes only repair membership. They never reorder groups or restyle existing groups.
// Remember generated group titles so navigation of a group's last tab is still recognized.
export async function reconcileWindow(api, windowId, managed = new Map()) {
  const initial = (await api.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const groups = await api.tabGroups.query({ windowId });
  const byId = new Map(groups.map(group => [group.id, group]));
  for (const group of groups) {
    const members = initial.filter(tab => tab.groupId === group.id);
    if (members.length && members.every(tab => domainOf(tab) === group.title)) managed.set(group.id, group.title);
    if (managed.has(group.id) && managed.get(group.id) !== group.title) managed.delete(group.id);
  }
  let changedCount = 0;
  for (const candidate of initial) {
    const current = await api.tabs.query({ windowId });
    const tab = current.find(item => item.id === candidate.id);
    if (!tab || tab.pinned) continue;
    const domain = domainOf(tab);
    // Avoid moving blank/loading new tabs, which may shortly acquire their real URL.
    if (domain === "Chrome 页面" || domain === "空白页面" || domain === "其他页面" || domain === "浏览器扩展") continue;
    const source = byId.get(tab.groupId);
    if (source && (source.title === domain || managed.get(source.id) !== source.title)) continue;
    const target = [...byId.values()].find(group => group.title === domain && managed.get(group.id) === domain &&
      current.some(item => item.groupId === group.id));
    let id;
    try {
      id = await api.tabs.group(target ? { groupId: target.id, tabIds: [tab.id] }
        : { createProperties: { windowId }, tabIds: [tab.id] });
    } catch (error) {
      const latest = (await api.tabs.query({ windowId })).find(item => item.id === tab.id);
      if (!latest || latest.pinned || domainOf(latest) !== domain) continue;
      throw error;
    }
    if (!target) {
      await api.tabGroups.update(id, { title: domain, color: colorOf(domain) });
      byId.set(id, { id, title: domain });
      managed.set(id, domain);
    }
    changedCount++;
  }
  return { changedCount };
}
