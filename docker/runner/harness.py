"""Function-call harness: import the student's module, call entryPoint(*args), write the JSON-encoded return value to a
result file (out-of-band from stdout so student prints cannot forge it). Receives ONLY args, never expected values."""
import importlib.util, json, os, sys, traceback

spec_in = json.loads(sys.stdin.read())
sys.path.insert(0, "/work")
os.chdir("/work")
rid = None


def enc(v):
    try:
        json.dumps(v)
        return {"json": v}
    except Exception:
        return {"repr": repr(v)}


def emit(obj):
    path = os.environ.get("SOCRA_RESULT") or ""
    sys.__stdout__.flush()
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh)


try:
    mod_path = os.path.join("/work", spec_in["module"])
    s = importlib.util.spec_from_file_location("student", mod_path)
    m = importlib.util.module_from_spec(s)
    sys.modules["student"] = m
    s.loader.exec_module(m)
    fn = getattr(m, spec_in["entryPoint"])
    out = fn(*spec_in["args"])
    emit({"ok": True, **enc(out)})
except SystemExit:
    emit({"ok": False, "error": "SystemExit"})
except BaseException:
    tb = traceback.format_exc().splitlines()
    emit({"ok": False, "error": "\n".join(tb[-6:])})
