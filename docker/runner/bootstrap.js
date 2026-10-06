// Socra sandbox bootstrap (Node). Same payload/result protocol as bootstrap.py. Expected values never enter the container.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const WORK = "/work";
const HARNESS = "/opt/socra/harness.js";

function readStdin() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === "EAGAIN") continue;
      if (e.code === "EOF") break;
      throw e;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function clip(b, cap) {
  const s = (b || Buffer.alloc(0)).toString("utf8");
  return s.length <= cap ? s : s.slice(0, cap);
}

function runOne(args, input, timeoutMs, cap, env) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, {
    input: Buffer.from(input || ""),
    cwd: WORK,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
    env: env || process.env,
  });
  const to = !!(r.error && r.error.code === "ETIMEDOUT");
  return { code: r.status, signal: r.signal, out: clip(r.stdout, cap), err: clip(r.stderr, cap), ms: Date.now() - t0, to };
}

const payload = JSON.parse(readStdin());
for (const f of payload.files) {
  const p = path.normalize(path.join(WORK, f.path));
  if (!p.startsWith(WORK + path.sep)) throw new Error("bad path");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, f.content, "utf8");
}
if (payload.mode === "run") {
  const r = spawnSync(process.execPath, [payload.entry], {
    input: Buffer.from(payload.stdin || ""),
    cwd: WORK,
    stdio: ["pipe", "inherit", "inherit"],
  });
  process.exit(r.status === null ? 137 : r.status);
}
const cap = payload.outCap || 8192;
const results = [];
for (const t of payload.tests) {
  const timeout = t.timeoutMs || 5000;
  if (t.kind === "stdio") {
    const r = runOne([payload.entry], t.stdin, timeout, cap);
    results.push({
      id: t.id, ok: r.code === 0 && !r.to, value: r.out, stdout: r.out, stderr: r.err, exitCode: r.code,
      durationMs: r.ms,
      status: r.to ? "TIMEOUT" : r.code === 0 ? "OK" : r.signal === "SIGKILL" || r.code === 137 ? "MEMORY_LIMIT" : "RUNTIME_ERROR",
    });
  } else {
    const rp = path.join("/tmp", `r_${process.pid}_${results.length}.json`);
    const spec = JSON.stringify({ module: payload.entry, entryPoint: t.entryPoint, args: t.args || [] });
    const r = runOne([HARNESS], spec, timeout, cap, Object.assign({}, process.env, { SOCRA_RESULT: rp }));
    const res = { id: t.id, ok: false, stdout: r.out, stderr: r.err, exitCode: r.code, durationMs: r.ms };
    if (r.to) res.status = "TIMEOUT";
    else if (fs.existsSync(rp)) {
      Object.assign(res, JSON.parse(fs.readFileSync(rp, "utf8")));
      fs.unlinkSync(rp);
      res.status = res.ok ? "OK" : "RUNTIME_ERROR";
    } else res.status = r.signal === "SIGKILL" || r.code === 137 ? "MEMORY_LIMIT" : "RUNTIME_ERROR";
    results.push(res);
  }
}
process.stdout.write(JSON.stringify({ results }));
