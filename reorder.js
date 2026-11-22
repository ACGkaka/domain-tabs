import { domainOf } from "./domain.js";

export async function reorderTab(api, windowId, sourceId, targetId, after) {
  if (sourceId === targetId) return;
  let tabs = await api.tabs.query({ windowId });
  let source = tabs.find(tab => tab.id === sourceId);
  let target = tabs.find(tab => tab.id === targetId);
  if (!source || !target) throw new Error("标签已关闭或移到其他窗口，请重试");
  if (Boolean(source.pinned) !== Boolean(target.pinned) || (!source.pinned && domainOf(source) !== domainOf(target))) {
    throw new Error("请在同一组内拖拽标签");
  }
  // A domain may span several native groups. Join the target's group before moving.
  if (!source.pinned && source.groupId !== target.groupId) {
    if (target.groupId >= 0) await api.tabs.group({ groupId: target.groupId, tabIds: [source.id] });
    else await api.tabs.ungroup(source.id);
    tabs = await api.tabs.query({ windowId });
    source = tabs.find(tab => tab.id === sourceId);
    target = tabs.find(tab => tab.id === targetId);
    if (!source || !target || source.pinned || target.pinned || domainOf(source) !== domainOf(target)) {
      throw new Error("标签状态已变化，请重试");
    }
  }
  const index = target.index + (after ? 1 : 0) - (source.index < target.index ? 1 : 0);
  if (index !== source.index) await api.tabs.move(source.id, { windowId, index });
}
