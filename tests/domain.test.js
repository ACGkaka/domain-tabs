import test from "node:test";
import assert from "node:assert/strict";
import { domainOf, groupByDomain, matchesSearch, colorOf, COLORS } from "../domain.js";
import { organizeWindow } from "../grouping.js";

test("groups by exact hostname, independent of protocol, port, and path", () => {
  assert.equal(domainOf({ url: "https://Example.COM:443/a" }), "example.com");
  assert.equal(domainOf({ url: "http://example.com:8080/b" }), "example.com");
  assert.equal(domainOf({ url: "https://sub.example.com" }), "sub.example.com");
  assert.equal(domainOf({ url: "https://old.test", pendingUrl: "https://new.test" }), "new.test");
  assert.equal(domainOf({ url: "file:///tmp/report.html" }), "本地文件");
  assert.equal(domainOf({ url: "chrome://newtab/" }), "Chrome 页面");
  assert.equal(domainOf({ url: "chrome-extension://abc/panel.html" }), "浏览器扩展");
  assert.equal(domainOf({}), "其他页面");
  const groups = groupByDomain([{ id: 1, url: "https://z.test" }, { id: 2, url: "https://a.test" }, { id: 3, url: "http://z.test" }]);
  assert.deepEqual(groups.map(([domain, tabs]) => [domain, tabs.map(tab => tab.id)]), [["a.test", [2]], ["z.test", [1, 3]]]);
  assert.equal(colorOf("a.test"), colorOf("a.test"));
  assert.ok(COLORS.includes(colorOf("a.test")));
});

test("search matches title and URL using all query tokens", () => {
  const tab = { title: "开发文档 Chrome", url: "https://developer.chrome.com/reference" };
  assert.ok(matchesSearch(tab, "CHROME 开发"));
  assert.ok(matchesSearch(tab, "developer reference"));
  assert.ok(matchesSearch(tab, ""));
  assert.equal(matchesSearch(tab, "开发 missing"), false);
});

function mockApi(tabs, groups = []) {
  const calls = [];
  let nextId = 100;
  const api = {
    tabs: {
      async query({ windowId }) { return tabs.filter(tab => tab.windowId === windowId).map(tab => ({ ...tab })); },
      async group(options) {
        calls.push(["group", options]);
        const id = options.groupId ?? nextId++;
        for (const tab of tabs) if (options.tabIds.includes(tab.id)) tab.groupId = id;
        return id;
      }
    },
    tabGroups: {
      async query({ windowId }) { return groups.filter(group => group.windowId === windowId); },
      async update(id, properties) { calls.push(["update", id, properties]); },
      async move(id, properties) { calls.push(["move", id, properties]); }
    }
  };
  return { api, calls };
}

test("organize leaves pinned and other-window tabs intact and reuses homogeneous groups", async () => {
  const tabs = [
    { id: 1, windowId: 1, url: "https://a.test", pinned: true, groupId: -1 },
    { id: 2, windowId: 1, url: "https://b.test", groupId: 8 },
    { id: 3, windowId: 1, url: "https://a.test", groupId: -1 },
    { id: 4, windowId: 1, url: "http://b.test/next", groupId: -1 },
    { id: 5, windowId: 2, url: "https://a.test", groupId: -1 }
  ];
  const { api, calls } = mockApi(tabs, [{ id: 8, windowId: 1, title: "b.test" }]);
  const result = await organizeWindow(api, 1);
  assert.deepEqual(result, { domainCount: 2, tabCount: 3, skippedCount: 0, pinnedCount: 1 });
  assert.equal(tabs[0].groupId, -1);
  assert.equal(tabs[4].groupId, -1);
  const groupCalls = calls.filter(([name]) => name === "group").map(([, options]) => options);
  assert.deepEqual(groupCalls, [{ createProperties: { windowId: 1 }, tabIds: [3] }, { groupId: 8, tabIds: [2, 4] }]);
  assert.deepEqual(calls.filter(([name]) => name === "update").map(([, , properties]) => properties.title), ["a.test", "b.test"]);
  assert.ok(calls.filter(([name]) => name === "move").every(([, , properties]) => properties.index === -1));
});

test("mixed-domain groups are split instead of incorrectly reused", async () => {
  const tabs = [{ id: 1, windowId: 1, url: "https://a.test", groupId: 8 }, { id: 2, windowId: 1, url: "https://b.test", groupId: 8 }];
  const { api, calls } = mockApi(tabs, [{ id: 8, windowId: 1, title: "a.test" }]);
  await organizeWindow(api, 1);
  assert.equal(calls.find(([name]) => name === "group")[1].groupId, undefined);
  assert.notEqual(tabs[0].groupId, tabs[1].groupId);
});

test("closed or navigated tabs are skipped when regrouping", async () => {
  const tabs = [{ id: 1, windowId: 1, url: "https://a.test", groupId: -1 }];
  const { api, calls } = mockApi(tabs);
  let queryCount = 0;
  api.tabs.query = async () => { queryCount++; return queryCount === 1 ? tabs : []; };
  assert.deepEqual(await organizeWindow(api, 1), { domainCount: 0, tabCount: 0, skippedCount: 1, pinnedCount: 0 });
  assert.equal(calls.length, 0);
});

test("real grouping failures propagate to the caller", async () => {
  const { api } = mockApi([{ id: 1, windowId: 1, url: "https://a.test" }]);
  api.tabs.group = async () => { throw new Error("Grouping denied"); };
  await assert.rejects(() => organizeWindow(api, 1), /Grouping denied/);
});
