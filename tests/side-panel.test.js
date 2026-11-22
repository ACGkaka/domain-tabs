import test from "node:test";
import assert from "node:assert/strict";
import { togglePanel, focusPanelSearch } from "../side-panel.js";

test("opens the panel in the requested window when closed", async () => {
  const calls=[];
  const api={runtime:{async getContexts(filter){calls.push(filter);return [];}},sidePanel:{async open(options){calls.push(options);}}};
  await togglePanel(api,7);
  assert.deepEqual(calls,[{contextTypes:["SIDE_PANEL"]},{windowId:7}]);
});
test("closes the current window's open panel on Chrome 141+", async () => {
  const calls=[];
  const api={runtime:{async getContexts(){return [{windowId:7}];}},sidePanel:{async close(options){calls.push(options);}}};
  await togglePanel(api,7);
  assert.deepEqual(calls,[{windowId:7}]);
});
test("older Chrome disables and restores the global panel", async () => {
  const calls=[];
  const api={runtime:{async getContexts(){return [{windowId:7}];}},tabs:{async query(options){calls.push(options);return [{id:8}];}},sidePanel:{async setOptions(options){calls.push(options);}}};
  await togglePanel(api,7);
  assert.deepEqual(calls,[{enabled:false},{path:"panel.html",enabled:true}]);
});

test("Chrome 138's unknown context window ID is resolved by the live panel", async () => {
  const calls=[];
  const api={runtime:{async getContexts(){return [{windowId:-1}];},async sendMessage(message){calls.push(message);return {open:true};}},sidePanel:{async close(options){calls.push(options);}}};
  await togglePanel(api,7);
  assert.deepEqual(calls,[{type:"is-panel-open",windowId:7},{windowId:7}]);
});

test("search command opens the requested panel and retries until its search listener is ready", async () => {
  const calls=[];
  let attempt=0;
  const api={sidePanel:{async open(options){calls.push(["open",options]);}},runtime:{async sendMessage(message){calls.push(["focus",message]);if(++attempt===1)throw new Error("Not ready");return {focused:true};}}};
  await focusPanelSearch(api,7,async()=>{});
  assert.deepEqual(calls,[["open",{windowId:7}],["focus",{type:"focus-panel-search",windowId:7}],["focus",{type:"focus-panel-search",windowId:7}]]);
});
test("search focus failure is bounded and reported", async () => {
  let calls=0;
  await assert.rejects(()=>focusPanelSearch({sidePanel:{async open(){}},runtime:{async sendMessage(){calls++;return undefined;}}},7,async()=>{}),/尚未就绪/);
  assert.equal(calls,20);
});
