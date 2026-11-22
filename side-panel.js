export async function togglePanel(api, windowId) {
  const contexts = await api.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
  let isOpen = contexts.some(context => context.windowId === windowId);
  // Older Chrome reports -1 for side-panel contexts. Ask the live panel which
  // browser window owns it instead of treating another window's panel as open.
  if (!isOpen && contexts.some(context => context.windowId === -1)) {
    try { isOpen = Boolean((await api.runtime.sendMessage({ type: "is-panel-open", windowId }))?.open); }
    catch { isOpen = false; }
  }
  if (!isOpen) {
    await api.sidePanel.open({ windowId });
    return;
  }
  if (api.sidePanel.close) {
    await api.sidePanel.close({ windowId });
  } else {
    // Chrome 116–140 has no close method. Disabling the global panel closes
    // this extension's panels in every window; then restore availability.
    try {
      await api.sidePanel.setOptions({ enabled: false });
    } finally {
      await api.sidePanel.setOptions({ path: "panel.html", enabled: true });
    }
  }
}

export async function focusPanelSearch(api, windowId, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  // Call open immediately while the shortcut's user gesture is still active.
  await api.sidePanel.open({ windowId });
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if ((await api.runtime.sendMessage({ type: "focus-panel-search", windowId }))?.focused) return;
    } catch { /* A newly opened panel may not have installed its listener yet. */ }
    await pause(100);
  }
  throw new Error("搜索框尚未就绪，请重试快捷键");
}
