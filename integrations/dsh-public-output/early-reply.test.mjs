import {test} from "node:test";
import assert from "node:assert/strict";
import {guard} from "./output.mjs";

const name = "conest_public_reply";
const options = {provider:"fixture", model:"fixture", messages:[], tools:[{name}]};
const text = rows => rows.filter(row => row.type === "text-delta").map(row => row.text).join("");
const empty = async function* () {yield {type:"finish", reason:{kind:"stop"}};};

for (const source of ["original", "finalizer"]) {
  for (const shape of ["tool", "json"]) {
    test(`${source} ${shape} starts speaking while the provider is still generating`, async () => {
      let release, calls = 0;
      const gate = new Promise(resolve => {release = resolve;});
      async function* response() {
        const raw = JSON.stringify({reply:"你好。后半段还在生成。"});
        const prefix = raw.slice(0, raw.indexOf("后半段"));
        if (shape === "tool") {
          yield {type:"tool-call-delta", index:0, id:"reply", name, argumentsDelta:prefix};
          await gate;
          yield {type:"block-end", index:0, block:{type:"tool-call", id:"reply", name, arguments:raw}};
        } else {
          yield {type:"text-delta", index:0, text:prefix};
          await gate;
          yield {type:"block-end", index:0, block:{type:"text", text:raw}};
        }
        yield {type:"finish", reason:{kind:shape === "tool" ? "tool-calls" : "stop"}};
      }
      const rows = [];
      const stream = guard(options, source === "original" ? response : empty, () => {calls++; return response();}, () => {}, true, true);
      const reader = (async () => {for await (const row of stream) rows.push(row);})();
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(text(rows), "你好。", "public first sentence remained buffered");
      } finally {release(); await reader;}
      assert.equal(text(rows), "你好。后半段还在生成。");
      assert.equal(calls, source === "original" ? 0 : 1);
      assert.equal(rows.at(-1).reason.kind, "stop");
      assert.equal(rows.some(row => row.type === "tool-call-delta"), false);
    });
  }
}
