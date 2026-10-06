// Function-call harness (Node): load the student's file in a vm context, call entryPoint(...args), write the JSON
// return value to SOCRA_RESULT (out-of-band). Receives ONLY args, never expected values.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const spec = JSON.parse(fs.readFileSync(0, "utf8"));
function emit(o) {
  fs.writeFileSync(process.env.SOCRA_RESULT, JSON.stringify(o));
}
try {
  const file = path.join("/work", spec.module);
  const code = fs.readFileSync(file, "utf8");
  const mod = { exports: {} };
  const ctx = vm.createContext({
    module: mod, exports: mod.exports, console, setTimeout, setInterval, clearTimeout, clearInterval,
    require: (n) => require(n.startsWith(".") ? path.resolve("/work", n) : n),
    process, Buffer, __filename: file, __dirname: "/work",
  });
  new vm.Script(code, { filename: file }).runInContext(ctx);
  let fn = mod.exports && mod.exports[spec.entryPoint];
  if (typeof fn !== "function" && mod.exports && typeof mod.exports === "function" && mod.exports.name === spec.entryPoint) fn = mod.exports;
  if (typeof fn !== "function") fn = vm.runInContext(`typeof ${spec.entryPoint} === "function" ? ${spec.entryPoint} : undefined`, ctx);
  if (typeof fn !== "function") throw new Error(`entry point '${spec.entryPoint}' is not defined`);
  Promise.resolve(fn(...spec.args)).then(
    (v) => {
      let enc;
      try {
        enc = v === undefined ? { json: null } : { json: JSON.parse(JSON.stringify(v)) };
        if (typeof v === "number" && !Number.isFinite(v)) enc = { repr: String(v) };
      } catch (e) {
        enc = { repr: String(v) };
      }
      emit({ ok: true, ...enc });
    },
    (e) => emit({ ok: false, error: String((e && e.stack) || e).split("\n").slice(0, 6).join("\n") }),
  );
} catch (e) {
  emit({ ok: false, error: String((e && e.stack) || e).split("\n").slice(0, 6).join("\n") });
}
