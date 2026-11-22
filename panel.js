import { domainOf, groupByDomain, matchesSearch, colorOf } from "./domain.js";
import { reorderTab } from "./reorder.js";
import { duplicatePlan, closeDuplicates } from "./duplicates.js";

const $ = id => document.getElementById(id);
const icons = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  collapse: '<path d="m6 9 6-5 6 5m-12 6 6 5 6-5M5 12h14"/>',
  expand: '<path d="m6 5 6 5 6-5m-12 14 6-5 6 5M5 12h14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>',
  newWindow: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M8 7V3h13v13h-4M14 10l7-7m-7 0h7v7"/>',
  pin: '<path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6"/>',
  duplicates: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>'
};
const colorValues = { green: "#52946c", blue: "#608cce", purple: "#9d7ec2", cyan: "#49a6aa", orange: "#c98b54", pink: "#c481a0", yellow: "#b4a047", red: "#c97575" };
const state = { windowId: null, hostWindowId: null, windows: [], tabs: [], pinnedDomains: [], collapsed: new Set(), searchCollapsed: new Set(), search: "", refreshVersion: 0 };
const windowNumbers = new Map();
let refreshTimer;
let toastTimer;
let pendingClose = null;
let draggedTab = null;
let suppressClickUntil = 0;
let duplicatesOnly = false;
let pendingDuplicates = null;

function clearDropMarkers() {
  document.querySelectorAll(".drop-before,.drop-after").forEach(row => row.classList.remove("drop-before", "drop-after"));
}
function finishDrag() {
  draggedTab = null;
  clearDropMarkers();
  document.querySelectorAll(".dragging").forEach(row => row.classList.remove("dragging"));
  suppressClickUntil = Date.now() + 200;
  scheduleRefresh();
}

function svg(name) {
  const span = document.createElement("span");
  // Only local, static icon markup is inserted as HTML. Tab text always uses textContent.
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  return span.firstElementChild;
}
function button(name, label, className = "icon-button") {
  const element = document.createElement("button");
  element.className = className;
  element.title = label;
  element.setAttribute("aria-label", label);
  element.append(svg(name));
  return element;
}
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4200);
}
async function act(callback) {
  try { await callback(); }
  catch (error) { toast(`操作未完成：${error.message}`); }
  finally { scheduleRefresh(); }
}
function saveCollapsed() {
  chrome.storage.local.set({ collapsedDomains: [...state.collapsed] }).catch(error => toast(`保存设置失败：${error.message}`));
}
function currentCollapsed() { return state.search ? state.searchCollapsed : state.collapsed; }
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refresh().catch(error => toast(`读取标签失败：${error.message}`)); }, 80);
}
async function refresh() {
  const version = ++state.refreshVersion;
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  if (version !== state.refreshVersion) return;
  state.windows = windows.sort((a, b) => a.id - b.id);
  if (!windows.some(window => window.id === state.windowId)) {
    const fallback = windows.find(window => window.id === state.hostWindowId) || windows[0];
    resetWindowView();
    state.windowId = fallback?.id ?? null;
  }
  state.tabs = (windows.find(window => window.id === state.windowId)?.tabs || []).sort((a, b) => a.index - b.index);
  renderWindowTabs();
  render();
}

function resetWindowView() {
  if (draggedTab) finishDrag();
  for (const id of ["confirm-dialog", "duplicates-dialog"]) if ($(id).open) $(id).close();
  pendingClose = null;
  pendingDuplicates = null;
  state.search = "";
  state.searchCollapsed.clear();
  duplicatesOnly = false;
  $("search").value = "";
}
function selectWindow(windowId) {
  if (windowId === state.windowId) return;
  const selected = state.windows.find(window => window.id === windowId);
  if (!selected) return;
  ++state.refreshVersion;
  resetWindowView();
  state.windowId = windowId;
  state.tabs = [...(selected.tabs || [])].sort((a, b) => a.index - b.index);
  renderWindowTabs();
  render();
  scheduleRefresh();
}
function renderWindowTabs() {
  const list = $("window-tabs");
  const scrollLeft = list.scrollLeft;
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.windowId : null;
  const buttons = state.windows.map(window => {
    if (!windowNumbers.has(window.id)) windowNumbers.set(window.id, windowNumbers.size + 1);
    const tab = document.createElement("button");
    const label = window.id === state.hostWindowId ? "本窗口" : `窗口 ${windowNumbers.get(window.id)}`;
    tab.id = `window-tab-${window.id}`;
    tab.dataset.windowId = window.id;
    tab.className = "window-tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "tab-list");
    tab.setAttribute("aria-selected", String(window.id === state.windowId));
    tab.tabIndex = window.id === state.windowId ? 0 : -1;
    tab.textContent = `${label}${window.incognito ? " · 无痕" : ""} · ${(window.tabs || []).length}`;
    tab.title = `${label}\n${window.tabs?.find(tab => tab.active)?.title || ""}`;
    tab.addEventListener("click", () => selectWindow(window.id));
    tab.addEventListener("keydown", event => {
      const index = state.windows.findIndex(item => item.id === window.id);
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % state.windows.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + state.windows.length) % state.windows.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = state.windows.length - 1;
      else return;
      event.preventDefault();
      const id = state.windows[next].id;
      selectWindow(id);
      $(`window-tab-${id}`)?.focus();
    });
    return tab;
  });
  list.replaceChildren(...buttons);
  list.hidden = state.windows.length <= 1;
  list.scrollLeft = scrollLeft;
  if (focusedId && $(`window-tab-${focusedId}`)) $(`window-tab-${focusedId}`).focus({ preventScroll: true });
  const active = $(`window-tab-${state.windowId}`);
  if (active) $("tab-list").setAttribute("aria-labelledby", active.id);
}

function tabRow(tab) {
  const row = document.createElement("div");
  row.className = `tab-row${tab.active ? " active" : ""}`;
  row.dataset.tabId = tab.id;
  row.draggable = true;
  row.title = "拖拽调整组内顺序";
  row.addEventListener("dragstart", event => {
    if (event.target.closest(".tab-actions")) { event.preventDefault(); return; }
    draggedTab = { id: tab.id, key: tab.pinned ? "__pinned__" : domainOf(tab) };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(tab.id));
    row.classList.add("dragging");
  });
  row.addEventListener("dragover", event => {
    const key = tab.pinned ? "__pinned__" : domainOf(tab);
    clearDropMarkers();
    if (!draggedTab || draggedTab.key !== key || draggedTab.id === tab.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    row.classList.add(after ? "drop-after" : "drop-before");
    if (event.clientY < 40) window.scrollBy(0, -18);
    else if (event.clientY > window.innerHeight - 40) window.scrollBy(0, 18);
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
  row.addEventListener("drop", event => {
    const key = tab.pinned ? "__pinned__" : domainOf(tab);
    if (!draggedTab || draggedTab.key !== key || draggedTab.id === tab.id) return;
    event.preventDefault();
    const sourceId = draggedTab.id;
    const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    finishDrag();
    act(() => reorderTab(chrome, tab.windowId, sourceId, tab.id, after));
  });
  row.addEventListener("dragend", finishDrag);
  const activate = document.createElement("button");
  activate.className = "tab-activate";
  activate.title = `${tab.title || "未命名标签"}\n${tab.pendingUrl || tab.url || ""}`;
  activate.setAttribute("aria-label", `切换到 ${tab.title || "未命名标签"}`);
  if (tab.active) activate.setAttribute("aria-current", "page");
  const fallback = document.createElement("span");
  fallback.className = "favicon-fallback";
  fallback.textContent = domainOf(tab).slice(0, 1).toUpperCase();
  fallback.setAttribute("aria-hidden", "true");
  if (tab.favIconUrl && /^(https?:|data:image\/)/i.test(tab.favIconUrl)) {
    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.alt = "";
    favicon.draggable = false;
    favicon.referrerPolicy = "no-referrer";
    favicon.src = tab.favIconUrl;
    favicon.addEventListener("error", () => { favicon.replaceWith(fallback); }, { once: true });
    activate.append(favicon);
  } else activate.append(fallback);
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title || "未命名标签";
  activate.append(title);
  if (duplicatesOnly) {
    const badge = document.createElement("span");
    badge.className = "duplicate-badge";
    badge.textContent = duplicatePlan(state.tabs).keepIds.has(tab.id) ? "保留" : "重复";
    activate.append(badge);
  }
  activate.addEventListener("click", () => {
    if (Date.now() >= suppressClickUntil) act(async () => {
      const updated = await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(updated.windowId, { focused: true });
    });
  });
  const actions = document.createElement("div");
  actions.className = "tab-actions";
  const copy = button("copy", "复制标签", "icon-button tab-copy");
  copy.addEventListener("click", () => act(async () => {
    const source = await chrome.tabs.get(tab.id);
    const url = source.pendingUrl || source.url;
    if (!url) throw new Error("无法读取该标签的网址");
    await chrome.tabs.create({ windowId: source.windowId, index: source.index + 1, url, active: false });
  }));
  const move = button("newWindow", "移到新窗口", "icon-button tab-new-window");
  move.addEventListener("click", () => act(async () => {
    const source = await chrome.tabs.get(tab.id);
    await chrome.windows.create({ tabId: source.id, focused: true, incognito: Boolean(source.incognito) });
  }));
  const pin = button("pin", tab.pinned ? "取消置顶" : "置顶标签", `icon-button tab-pin${tab.pinned ? " is-pinned" : ""}`);
  pin.setAttribute("aria-pressed", String(Boolean(tab.pinned)));
  pin.addEventListener("click", () => act(() => chrome.tabs.update(tab.id, { pinned: !tab.pinned })));
  const close = button("close", "关闭标签", "icon-button tab-close");
  close.addEventListener("click", () => act(() => chrome.tabs.remove(tab.id)));
  actions.append(copy, move, pin, close);
  row.append(activate, actions);
  return row;
}

function domainGroup(domain, tabs, totalCount, pinned = false) {
  const key = pinned ? "__pinned__" : domain;
  const group = document.createElement("details");
  group.className = `domain-group${pinned ? " pinned-group" : ""}`;
  group.dataset.domain = key;
  group.style.setProperty("--domain-color", colorValues[colorOf(domain)]);
  group.open = !currentCollapsed().has(key);
  const summary = document.createElement("summary");
  summary.title = pinned ? "固定的标签" : domain;
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.append(svg("chevron"));
  const dot = document.createElement("span");
  dot.className = "domain-dot";
  const name = document.createElement("span");
  name.className = "domain-name";
  name.textContent = pinned ? "固定标签" : domain;
  const count = document.createElement("span");
  count.className = "domain-count";
  count.textContent = tabs.length === totalCount ? String(totalCount) : `${tabs.length}/${totalCount}`;
  summary.append(chevron, dot, name, count);
  if (!pinned) {
    const isPinned = state.pinnedDomains.includes(domain);
    group.classList.toggle("domain-is-pinned", isPinned);
    const pin = button("pin", isPinned ? "取消分组置顶" : "置顶域名分组", `icon-button domain-pin${isPinned ? " is-pinned" : ""}`);
    pin.setAttribute("aria-pressed", String(isPinned));
    pin.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const previous = state.pinnedDomains;
      state.pinnedDomains = isPinned ? previous.filter(item => item !== domain) : [domain, ...previous];
      render();
      try { await chrome.storage.local.set({ pinnedDomains: state.pinnedDomains }); }
      catch (error) { state.pinnedDomains = previous; render(); toast(`保存置顶失败：${error.message}`); }
    });
    summary.append(pin);
    const close = button("close", `关闭 ${domain} 下${state.search ? "匹配的" : "所有"} ${tabs.length} 个标签`, "icon-button domain-close");
    close.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (tabs.length === 1) act(() => closeMatchingTabs(domain, tabs.map(tab => tab.id), tabs[0].windowId));
      else {
        pendingClose = { domain, ids: tabs.map(tab => tab.id), windowId: state.windowId };
        $("confirm-title").textContent = `关闭 ${tabs.length} 个标签？`;
        $("confirm-description").textContent = `将关闭 ${domain} 下${state.search ? "匹配搜索的" : "的"} ${tabs.length} 个标签。可通过 Chrome 的“重新打开关闭的标签”恢复。`;
        $("confirm-dialog").showModal();
        $("cancel-close").focus();
      }
    });
    summary.append(close);
  }
  summary.addEventListener("click", event => {
    if (event.target.closest("button")) return;
    event.preventDefault();
    group.open = !group.open;
    if (group.open) currentCollapsed().delete(key);
    else currentCollapsed().add(key);
    if (!state.search) saveCollapsed();
    updateCollapseButton();
  });
  const content = document.createElement("div");
  content.className = "tabs";
  content.append(...tabs.map(tabRow));
  group.append(summary, content);
  return group;
}

async function closeMatchingTabs(domain, ids, windowId) {
  const requested = new Set(ids);
  const current = await chrome.tabs.query({ windowId });
  const valid = current.filter(tab => requested.has(tab.id) && !tab.pinned && domainOf(tab) === domain);
  if (valid.length) await chrome.tabs.remove(valid.map(tab => tab.id));
}
function updateCollapseButton() {
  const groups = [...document.querySelectorAll(".domain-group")];
  const allClosed = groups.length > 0 && groups.every(group => !group.open);
  const label = allClosed ? "展开全部域名" : "收起全部域名";
  $("collapse-all").replaceChildren(svg(allClosed ? "expand" : "collapse"));
  $("collapse-all").title = label;
  $("collapse-all").setAttribute("aria-label", label);
  $("collapse-all").disabled = groups.length === 0;
}
function render() {
  if (draggedTab) return;
  $("tab-count").textContent = state.tabs.length;
  $("domain-count").textContent = groupByDomain(state.tabs).length;
  const plan = duplicatePlan(state.tabs);
  const visibleTabs = state.tabs.filter(tab => matchesSearch(tab, state.search) && (!duplicatesOnly || plan.memberIds.has(tab.id)));
  $("show-duplicates").title = `查看重复标签（${plan.close.length} 个可清理）`;
  $("show-duplicates").setAttribute("aria-pressed", String(duplicatesOnly));
  $("duplicates-bar").hidden = !duplicatesOnly;
  $("duplicates-count").textContent = `${plan.groups.length} 个重复网址 · ${plan.close.length} 个可清理`;
  $("close-duplicates").disabled = plan.close.length === 0;
  const visibleIds = new Set(visibleTabs.map(tab => tab.id));
  $("search-status").textContent = state.search ? `找到 ${visibleTabs.length} 个匹配标签` : "";
  const children = [];
  const pinned = state.tabs.filter(tab => tab.pinned);
  const visiblePinned = pinned.filter(tab => visibleIds.has(tab.id));
  const topGroups = [];
  for (const [domain, tabs] of groupByDomain(state.tabs.filter(tab => !tab.pinned))) {
    const matching = tabs.filter(tab => visibleIds.has(tab.id));
    if (matching.length) {
      const group = domainGroup(domain, matching, tabs.length);
      if (state.pinnedDomains.includes(domain)) topGroups.push(group);
      else children.push(group);
    }
  }
  topGroups.sort((a, b) => state.pinnedDomains.indexOf(a.dataset.domain) - state.pinnedDomains.indexOf(b.dataset.domain));
  if (visiblePinned.length) topGroups.push(domainGroup("固定标签", visiblePinned, pinned.length, true));
  children.unshift(...topGroups);
  // Replacing nodes would otherwise reset scrolling on every tab update.
  const scrollTop = document.documentElement.scrollTop;
  $("tab-list").replaceChildren(...children);
  document.documentElement.scrollTop = scrollTop;
  $("empty").hidden = visibleTabs.length !== 0;
  $("empty").querySelector("strong").textContent = state.search ? "没有找到匹配的标签" : "所选窗口暂无标签";
  $("empty").querySelector("p").textContent = state.search ? "试试其他标题或域名关键词" : "打开网页后会自动显示在这里";
  if (duplicatesOnly && !state.search) {
    $("empty").querySelector("strong").textContent = "没有重复标签";
    $("empty").querySelector("p").textContent = "所选窗口中没有完整网址相同的标签";
  }
  $("clear-search").hidden = !state.search;
  updateCollapseButton();
}

function clearSearch() {
  $("search").value = "";
  state.search = "";
  render();
  $("search").focus();
}
function closeSettings() {
  $("settings-menu").hidden = true;
  $("settings-button").setAttribute("aria-expanded", "false");
}
function showHelp() { closeSettings(); $("help-dialog").showModal(); }
function focusSearch() {
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  closeSettings();
  window.focus();
  $("search").focus({ preventScroll: true });
  $("search").select();
}

async function init() {
  $("settings-button").append(svg("settings"));
  $("search-icon").append(svg("search"));
  $("empty-icon").append(svg("search"));
  $("close-help").append(svg("close"));
  $("show-duplicates").append(svg("duplicates"));
  $("show-duplicates").addEventListener("click", () => { duplicatesOnly = !duplicatesOnly; render(); });
  $("exit-duplicates").addEventListener("click", () => { duplicatesOnly = false; render(); });
  $("close-duplicates").addEventListener("click", () => {
    const plan = duplicatePlan(state.tabs);
    if (!plan.close.length) return;
    pendingDuplicates = { windowId: state.windowId, tabs: plan.groups.flatMap(([url, members]) => members.map(tab => ({ id: tab.id, url }))) };
    $("duplicates-description").textContent = `将清理所选窗口 ${plan.close.length} 个重复标签（包括未匹配搜索的重复项）。按完整网址比较，参数和页面锚点不同不算重复。已置顶标签保留；没有置顶副本时，优先保留当前标签，否则保留最左侧副本。`;
    $("duplicates-dialog").showModal();
    $("cancel-duplicates").focus();
  });
  $("cancel-duplicates").addEventListener("click", () => $("duplicates-dialog").close());
  $("confirm-duplicates").addEventListener("click", () => {
    const approved = pendingDuplicates;
    $("duplicates-dialog").close();
    if (!approved) return;
    act(async () => {
      const count = await closeDuplicates(chrome, approved.windowId, approved.tabs);
      if (state.windowId === approved.windowId) {
        duplicatesOnly = false;
        await refresh();
      }
      toast(`已关闭 ${count} 个重复标签`);
    });
  });
  $("duplicates-dialog").addEventListener("close", () => { pendingDuplicates = null; });
  const [window, settings] = await Promise.all([
    chrome.windows.getCurrent(),
    chrome.storage.local.get(["autoGroup", "collapsedDomains", "pinnedDomains"])
  ]);
  state.windowId = window.id;
  state.hostWindowId = window.id;
  const ownTab = await chrome.tabs.getCurrent();
  if (!ownTab) chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message.windowId !== state.hostWindowId) return;
    if (message.type === "is-panel-open") sendResponse({ open: true });
    if (message.type === "focus-panel-search") {
      focusSearch();
      sendResponse({ focused: document.activeElement === $("search") });
    }
  });
  state.collapsed = new Set(Array.isArray(settings.collapsedDomains) ? settings.collapsedDomains : []);
  state.pinnedDomains = Array.isArray(settings.pinnedDomains) ? settings.pinnedDomains : [];
  $("auto-group").checked = Boolean(settings.autoGroup);
  $("settings-button").addEventListener("click", () => {
    const opening = $("settings-menu").hidden;
    $("settings-menu").hidden = !opening;
    $("settings-button").setAttribute("aria-expanded", String(opening));
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".settings-anchor")) closeSettings();
  });
  document.addEventListener("focusin", event => {
    if (!event.target.closest(".settings-anchor")) closeSettings();
  });
  $("auto-group").addEventListener("change", async () => {
    const enabled = $("auto-group").checked;
    $("auto-group").disabled = true;
    try {
      await chrome.storage.local.set({ autoGroup: enabled });
      toast(enabled ? "已开启：所有普通窗口将自动按域名整理" : "已关闭自动整理");
    } catch (error) {
      $("auto-group").checked = !enabled;
      toast(`保存设置失败：${error.message}`);
    } finally { $("auto-group").disabled = false; }
  });
  $("search").addEventListener("input", () => {
    state.search = $("search").value.trim();
    state.searchCollapsed.clear();
    render();
  });
  $("clear-search").addEventListener("click", clearSearch);
  $("organize").addEventListener("click", async () => {
    $("organize").disabled = true;
    $("organize-label").textContent = "整理中";
    try {
      const result = await chrome.runtime.sendMessage({ type: "organize", windowId: state.windowId });
      if (!result?.ok) throw new Error(result?.error || "整理未完成，请重试");
      toast(`已整理 ${result.tabCount} 个标签、${result.domainCount} 个域名${result.skippedCount ? `；${result.skippedCount} 个标签发生变化，点击重试` : ""}`);
    } catch (error) { toast(`整理未完成：${error.message}`); }
    finally {
      $("organize").disabled = false;
      $("organize-label").textContent = "整理";
      scheduleRefresh();
    }
  });
  $("collapse-all").addEventListener("click", () => {
    const groups = [...document.querySelectorAll(".domain-group")];
    const expand = groups.every(group => !group.open);
    for (const group of groups) {
      group.open = expand;
      if (expand) currentCollapsed().delete(group.dataset.domain);
      else currentCollapsed().add(group.dataset.domain);
    }
    if (!state.search) saveCollapsed();
    updateCollapseButton();
  });
  $("help-button").addEventListener("click", showHelp);
  $("shortcut-settings").addEventListener("click", () => act(async () => {
    closeSettings();
    await chrome.tabs.create({ windowId: state.windowId, url: "chrome://extensions/shortcuts" });
  }));
  $("position-help").addEventListener("click", showHelp);
  $("close-help").addEventListener("click", () => $("help-dialog").close());
  $("open-settings").addEventListener("click", () => act(async () => {
    await chrome.tabs.create({ windowId: state.windowId, url: "chrome://settings/appearance" });
    $("help-dialog").close();
  }));
  $("cancel-close").addEventListener("click", () => $("confirm-dialog").close());
  $("confirm-close").addEventListener("click", () => {
    const requested = pendingClose;
    $("confirm-dialog").close();
    if (requested) act(() => closeMatchingTabs(requested.domain, requested.ids, requested.windowId));
  });
  $("confirm-dialog").addEventListener("close", () => { pendingClose = null; });
  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      focusSearch();
      return;
    }
    if (event.key === "Escape" && !$("settings-menu").hidden) {
      closeSettings();
      $("settings-button").focus();
      return;
    }
    if (document.querySelector("dialog[open]") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "/" && !event.target.matches("input, textarea")) {
      event.preventDefault();
      $("search").focus();
    }
    if (event.key === "Escape" && state.search) clearSearch();
  });
  for (const event of [chrome.tabs.onCreated, chrome.tabs.onUpdated, chrome.tabs.onRemoved,
    chrome.tabs.onActivated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached,
    chrome.windows.onCreated, chrome.windows.onRemoved]) event.addListener(scheduleRefresh);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.pinnedDomains) {
      state.pinnedDomains = Array.isArray(changes.pinnedDomains.newValue) ? changes.pinnedDomains.newValue : [];
      render();
    }
    if (area === "local" && changes.autoGroup) $("auto-group").checked = Boolean(changes.autoGroup.newValue);
    if (area === "local" && changes.collapsedDomains) {
      state.collapsed = new Set(changes.collapsedDomains.newValue || []);
      render();
    }
  });
  await refresh();
}
init().catch(error => toast(`启动失败：${error.message}`));
