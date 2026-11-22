import { organizeWindow, reconcileWindow } from "./grouping.js";
import { togglePanel, focusPanelSearch } from "./side-panel.js";

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-panel" && command !== "focus-search") return;
  const toggle = async () => {
    const windowId = tab?.windowId ?? (await chrome.windows.getLastFocused({ windowTypes: ["normal"] })).id;
    if (command === "focus-search") await focusPanelSearch(chrome, windowId);
    else await togglePanel(chrome, windowId);
  };
  toggle().catch(error => console.warn("切换侧栏失败", error.message));
});

const queues = new Map();
const timers = new Map();
let saveQueue = Promise.resolve();

function organize(windowId, incremental = false) {
  const previous = queues.get(windowId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const settings = await chrome.storage.local.get(["autoGroup", "managedDomainGroups"]);
    if (incremental && !settings.autoGroup) return;
    const managed = new Map(Object.entries(settings.managedDomainGroups || {}).map(([id, title]) => [Number(id), title]));
    const result = incremental ? await reconcileWindow(chrome, windowId, managed) : await organizeWindow(chrome, windowId);
    const groups = await chrome.tabGroups.query({ windowId });
    if (!incremental) for (const group of groups) managed.set(group.id, group.title);
    const save = saveQueue.catch(() => {}).then(async () => {
      const latest = (await chrome.storage.local.get("managedDomainGroups")).managedDomainGroups || {};
      const tabs = await chrome.tabs.query({ windowId });
      for (const group of groups) {
        if (managed.get(group.id) === group.title && tabs.some(tab => tab.groupId === group.id)) latest[group.id] = group.title;
        else delete latest[group.id];
      }
      const allGroups = await chrome.tabGroups.query({});
      const allIds = new Set(allGroups.map(group => group.id));
      for (const id of Object.keys(latest)) if (!allIds.has(Number(id))) delete latest[id];
      await chrome.storage.local.set({ managedDomainGroups: latest });
    });
    saveQueue = save;
    await save;
    return result;
  });
  queues.set(windowId, next);
  next.finally(() => {
    if (queues.get(windowId) === next) queues.delete(windowId);
  }).catch(() => {});
  return next;
}

async function schedule(windowId) {
  if (!Number.isInteger(windowId) || windowId < 0) return;
  const { autoGroup = false } = await chrome.storage.local.get("autoGroup");
  if (!autoGroup) return;
  clearTimeout(timers.get(windowId));
  timers.set(windowId, setTimeout(async () => {
    timers.delete(windowId);
    const settings = await chrome.storage.local.get("autoGroup");
    if (!settings.autoGroup) return;
    try {
      const window = await chrome.windows.get(windowId);
      if (window.type === "normal") await organize(windowId, true);
    } catch (error) {
      console.warn("自动整理标签未完成", error.message);
    }
  }, 650));
}

function enablePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}
enablePanel();
chrome.runtime.onInstalled.addListener(enablePanel);
chrome.runtime.onStartup.addListener(enablePanel);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message.type !== "organize") return;
  if (!Number.isInteger(message.windowId) || message.windowId < 0) {
    sendResponse({ ok: false, error: "没有找到当前窗口" });
    return;
  }
  organize(message.windowId).then(
    result => sendResponse({ ok: true, ...result }),
    error => sendResponse({ ok: false, error: error.message })
  );
  return true;
});

chrome.tabs.onCreated.addListener(tab => { schedule(tab.windowId).catch(console.error); });
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.url !== undefined || change.pinned !== undefined) schedule(tab.windowId).catch(console.error);
});
chrome.tabs.onAttached.addListener((id, info) => { schedule(info.newWindowId).catch(console.error); });
chrome.windows.onRemoved.addListener(id => {
  clearTimeout(timers.get(id));
  timers.delete(id);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.autoGroup) return;
  if (!changes.autoGroup.newValue) {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    return;
  }
  chrome.windows.getAll({ windowTypes: ["normal"] }).then(windows => {
    for (const window of windows) schedule(window.id).catch(console.error);
  }).catch(console.error);
});
