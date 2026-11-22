import test from "node:test";
import assert from "node:assert/strict";
import { reorderTab } from "../reorder.js";

function mock(tabs) {
  const calls = [];
  return { calls, api: { tabs: {
    async query() { return tabs.map(tab => ({ ...tab })); },
    async move(id, options) { calls.push(["move", id, options]); },
    async group({ groupId, tabIds }) { calls.push(["group", groupId]); tabs.find(tab => tab.id === tabIds[0]).groupId = groupId; },
    async ungroup(id) { calls.push(["ungroup", id]); tabs.find(tab => tab.id === id).groupId = -1; }
  } } };
}
const tab = (id, index, overrides = {}) => ({ id, index, url: "https://a.test", groupId: -1, pinned: false, ...overrides });

test("moving forward and backward calculates final insertion index", async () => {
  for (const [source, target, after, expected] of [[1,3,true,4],[1,3,false,3],[3,1,true,1],[3,1,false,0]]) {
    const { api, calls } = mock([tab(1,0),tab(2,2),tab(3,4)]);
    await reorderTab(api, 7, source, target, after);
    assert.deepEqual(calls, [["move",source,{windowId:7,index:expected}]]);
  }
});
test("different domains, pinned boundaries and closed tabs reject without moving", async () => {
  for (const tabs of [[tab(1,0),tab(2,1,{url:"https://b.test"})],[tab(1,0,{pinned:true}),tab(2,1)],[tab(1,0)]]) {
    const {api,calls}=mock(tabs);
    await assert.rejects(()=>reorderTab(api,7,1,2,true));
    assert.deepEqual(calls,[]);
  }
});
test("pinned tabs can reorder within their group", async () => {
  const {api,calls}=mock([tab(1,0,{pinned:true}),tab(2,1,{pinned:true,url:"https://b.test"})]);
  await reorderTab(api,7,2,1,false);
  assert.deepEqual(calls,[["move",2,{windowId:7,index:0}]]);
});
test("moving into or out of a native group keeps target membership", async () => {
  for(const groupId of [9,-1]) {
    const {api,calls}=mock([tab(1,0,{groupId:8}),tab(2,3,{groupId})]);
    await reorderTab(api,7,1,2,true);
    assert.equal(calls[0][0],groupId>=0?"group":"ungroup");
    assert.deepEqual(calls.at(-1),["move",1,{windowId:7,index:3}]);
  }
});
