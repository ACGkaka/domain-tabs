import test from "node:test";
import assert from "node:assert/strict";
import { reconcileWindow } from "../grouping.js";

function fixture(tabs, groups) {
  const calls = [];
  let nextId = 100;
  const api = {
    tabs: {
      async query({ windowId }) { return tabs.filter(t => t.windowId === windowId).map(t => ({ ...t })); },
      async group(options) {
        calls.push(["group", options]);
        const id = options.groupId ?? nextId++;
        if (options.groupId === undefined) groups.push({ id, windowId: 1 });
        tabs.filter(t => options.tabIds.includes(t.id)).forEach(t => { t.groupId = id; });
        return id;
      }
    },
    tabGroups: {
      async query() { return groups.map(g => ({ ...g })); },
      async update(id, props) { calls.push(["update", id, props]); Object.assign(groups.find(g => g.id === id), props); },
      async move() { throw new Error("Automatic grouping must not move groups"); }
    }
  };
  return { api, calls };
}
const tab = (id, domain, groupId = -1, extra = {}) => ({ id, index: id, windowId: 1, url: `https://${domain}/`, groupId, ...extra });

test("unchanged domains and repeated automatic passes cause no mutations", async () => {
  const tabs = [tab(1, "b.test", 8), tab(2, "a.test", 9)];
  const groups = [{id:8,title:"b.test",collapsed:true,color:"red"},{id:9,title:"a.test"}];
  const {api,calls} = fixture(tabs, groups);
  await reconcileWindow(api,1);
  tabs[0].url = "https://b.test/another?query=1";
  await reconcileWindow(api,1);
  assert.deepEqual(calls, []);
  assert.equal(groups[0].collapsed,true);
  assert.equal(groups[0].color,"red");
});

test("only new members join existing groups, new domains stay near their source, reruns are idle", async () => {
  const tabs = [tab(1,"a.test",8),tab(2,"a.test"),tab(3,"b.test"),tab(4,"b.test"),tab(5,"a.test",-1,{pinned:true}),tab(6,"a.test",-1,{windowId:2})];
  const {api,calls} = fixture(tabs,[{id:8,title:"a.test"}]);
  const managed = new Map();
  assert.equal((await reconcileWindow(api,1,managed)).changedCount,3);
  assert.deepEqual(calls.filter(c=>c[0]==="group").map(c=>c[1]),[
    {groupId:8,tabIds:[2]}, {createProperties:{windowId:1},tabIds:[3]}, {groupId:100,tabIds:[4]}
  ]);
  assert.equal(calls.filter(c=>c[0]==="update").length,1);
  assert.equal(tabs[4].groupId,-1);
  assert.equal(tabs[5].groupId,-1);
  calls.length=0;
  await reconcileWindow(api,1,managed);
  assert.deepEqual(calls,[]);
});

test("cross-domain navigation moves only the changed member, including a sole member", async () => {
  const tabs=[tab(1,"b.test",8),tab(2,"b.test",9),tab(3,"a.test",8)];
  const {api,calls}=fixture(tabs,[{id:8,title:"a.test"},{id:9,title:"b.test"}]);
  const managed=new Map([[8,"a.test"],[9,"b.test"]]);
  await reconcileWindow(api,1,managed);
  assert.deepEqual(calls,[["group",{groupId:9,tabIds:[1]}]]);
  tabs[2].url="https://b.test/next";
  calls.length=0;
  await reconcileWindow(api,1,managed);
  assert.deepEqual(calls,[["group",{groupId:9,tabIds:[3]}]]);
});

test("custom and renamed groups remain intact, placeholder new tabs are not grouped", async () => {
  const tabs=[tab(1,"a.test",8),tab(2,"b.test",8),tab(3,"c.test",9),{id:4,index:4,windowId:1,groupId:-1,url:"chrome://newtab/"}];
  const {api,calls}=fixture(tabs,[{id:8,title:"工作"},{id:9,title:"自定义"}]);
  const managed=new Map([[9,"c.test"]]);
  await reconcileWindow(api,1,managed);
  assert.deepEqual(calls,[]);
  assert.equal(managed.has(9),false);
});

test("concurrent close is skipped but actual grouping failures are reported", async () => {
  const tabs=[tab(1,"a.test")];
  const {api,calls}=fixture(tabs,[]);
  let n=0;
  api.tabs.query=async()=>++n===1?tabs:[];
  await reconcileWindow(api,1);
  assert.deepEqual(calls,[]);
  api.tabs.query=async()=>tabs;
  api.tabs.group=async()=>{throw new Error("Denied");};
  await assert.rejects(()=>reconcileWindow(api,1),/Denied/);
});
