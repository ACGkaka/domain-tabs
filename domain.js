export const COLORS = ["green", "blue", "purple", "cyan", "orange", "pink", "yellow", "red"];

export function domainOf(tab) {
  try {
    const url = new URL(tab.pendingUrl || tab.url || "");
    if (url.protocol === "file:") return "本地文件";
    if (url.protocol === "chrome:" || url.protocol === "chrome-search:") return "Chrome 页面";
    if (url.protocol === "chrome-extension:") return "浏览器扩展";
    if (url.protocol === "about:") return "空白页面";
    return url.hostname.toLowerCase() || "其他页面";
  } catch {
    return "其他页面";
  }
}

export function colorOf(domain) {
  let hash = 0;
  for (const character of domain) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return COLORS[(hash >>> 0) % COLORS.length];
}

export function groupByDomain(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    const domain = domainOf(tab);
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(tab);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "en"));
}

export function matchesSearch(tab, search) {
  const tokens = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${tab.title || ""} ${tab.url || ""} ${tab.pendingUrl || ""} ${domainOf(tab)}`.toLocaleLowerCase();
  return tokens.every(token => haystack.includes(token));
}
