"""Socra sandbox bootstrap (Python). Reads ONE JSON payload from stdin, unpacks files to /work, runs.

Payload: {mode: "run"|"tests", entry, stdin, files:[{path,content}], tests:[{id,kind,entryPoint,args,stdin,timeoutMs}], outCap}
Expected values are NEVER sent to the container: the host compares. In "tests" mode this prints exactly one JSON
document on stdout: {"results":[{id, ok, value?, stdout, stderr, exitCode, durationMs, status, error?}]}.
"""
import json, os, subprocess, sys, time

WORK = "/work"
HARNESS = "/opt/socra/harness.py"


def write_files(files):
    for f in files:
        p = os.path.normpath(os.path.join(WORK, f["path"]))
        if not p.startswith(WORK + os.sep):
            raise SystemExit("bad path")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(f["content"])


def clip(b, cap):
    s = b.decode("utf-8", "replace")
    return s if len(s) <= cap else s[:cap]


def run_one(cmd, stdin, timeout, cap, env=None):
    t0 = time.time()
    try:
        p = subprocess.run(cmd, input=(stdin or "").encode(), capture_output=True, timeout=timeout, cwd=WORK, env=env)
        return p.returncode, clip(p.stdout, cap), clip(p.stderr, cap), int((time.time() - t0) * 1000), False
    except subprocess.TimeoutExpired as e:
        return None, clip(e.stdout or b"", cap), clip(e.stderr or b"", cap), int((time.time() - t0) * 1000), True


def main():
    payload = json.loads(sys.stdin.read())
    write_files(payload["files"])
    entry = payload["entry"]
    if payload["mode"] == "run":
        # Pass-through so the host sees raw output and the real exit code.
        sys.stdout.flush()
        os.chdir(WORK)
        r = subprocess.run([sys.executable, entry], input=(payload.get("stdin") or "").encode(), cwd=WORK)
        sys.exit(r.returncode if r.returncode >= 0 else 128 - r.returncode)
    cap = int(payload.get("outCap", 8192))
    results = []
    for t in payload["tests"]:
        timeout = (t.get("timeoutMs") or 5000) / 1000.0
        if t["kind"] == "stdio":
            code, out, err, ms, to = run_one([sys.executable, entry], t.get("stdin"), timeout, cap)
            results.append({"id": t["id"], "ok": code == 0 and not to, "value": out, "stdout": out, "stderr": err,
                            "exitCode": code, "durationMs": ms, "status": "TIMEOUT" if to else ("OK" if code == 0 else ("MEMORY_LIMIT" if code in (-9, 137) else "RUNTIME_ERROR"))})
        else:
            spec = json.dumps({"module": entry, "entryPoint": t["entryPoint"], "args": t.get("args", [])})
            rp = os.path.join("/tmp", "r_%d_%d.json" % (os.getpid(), len(results)))
            env = dict(os.environ, SOCRA_RESULT=rp)
            code, out, err, ms, to = run_one([sys.executable, HARNESS], spec, timeout, cap, env)
            res = {"id": t["id"], "ok": False, "stdout": "", "stderr": err, "exitCode": code, "durationMs": ms}
            if to:
                res["status"] = "TIMEOUT"
            else:
                if os.path.exists(rp):
                    with open(rp, encoding="utf-8") as fh:
                        r = json.load(fh)
                    os.unlink(rp)
                    res.update(r)
                    res["stdout"] = out
                    res["status"] = "OK" if r.get("ok") else "RUNTIME_ERROR"
                else:
                    res["stdout"] = out
                    res["status"] = "MEMORY_LIMIT" if code in (-9, 137) else "RUNTIME_ERROR"
            results.append(res)
    sys.stdout.write(json.dumps({"results": results}))
    sys.stdout.flush()


main()
