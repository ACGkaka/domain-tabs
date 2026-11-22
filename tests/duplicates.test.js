import test from "node:test";
import assert from "node:assert/strict";
import { duplicatePlan, closeDuplicates } from "../duplicates.js";
const tab = (id, overrides = {}) => ({ id, index: id, url: "https://a.test/page", ...overrides });

test("exact URLs preserve path, query and hash distinctions; active copy is kept", () => {
  const plan = duplicatePlan([tab(1), tab(2,{active:true}), tab(3,{url:"https://a.test/page?q=1"}), tab(4,{url:"https://a.test/page#one"}), tab(5,{url:undefined})]);
  assert.equal(plan.groups.length,1);
  assert.deepEqual(plan.close,[{id:1,url:"https://a.test/page"}]);
  assert.deepEqual([...plan.keepIds],[2]);
});
test("all pinned copies are protected; otherwise leftmost is kept", () => {
  assert.deepEqual(duplicatePlan([tab(1),tab(2)]).close.map(t=>t.id),[2]);
  assert.deepEqual(duplicatePlan([tab(1,{pinned:true}),tab(2,{pinned:true}),tab(3)]).close.map(t=>t.id),[3]);
});
test("closing revalidates navigation, pinned status, new tabs and retained copies", async () => {
  const reviewed=duplicatePlan([tab(1),tab(2),tab(3),tab(4)]).close;
  const calls=[];
  const api={tabs:{async query({windowId}){assert.equal(windowId,7);return [tab(1),tab(2,{url:"https://b.test"}),tab(3,{pinned:true}),tab(4),tab(5)];},async remove(ids){calls.push(ids);}}};
  assert.equal(await closeDuplicates(api,7,reviewed),1);
  assert.deepEqual(calls,[[4]]);
});
test("the sole surviving copy is never closed",async()=>{
  const api={tabs:{async query(){return [tab(2)];},async remove(){assert.fail("must retain last copy");}}};
  assert.equal(await closeDuplicates(api,7,[tab(2)]),0);
});
test("a changed active copy is kept while another reviewed copy is closed",async()=>{
  const calls=[];
  const api={tabs:{async query(){return [tab(1,{active:true}),tab(2),tab(3)];},async remove(ids){calls.push(ids);}}};
  assert.equal(await closeDuplicates(api,7,[tab(1),tab(2)]),1);
  assert.deepEqual(calls,[[2]]);
});
