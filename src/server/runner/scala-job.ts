import type { RunFile, TestSpec } from "./types";

/**
 * Scala 3 job protocol. The Scala image has no Python/Node, so the host sends a POSIX shell script on stdin (files are
 * base64-embedded) and parses nonce-tagged marker lines from stdout. Student output travels base64-encoded, and the
 * markers carry a per-run random nonce, so it cannot inject fake results. Expected values never enter the container.
 */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function writeFileCmd(dir: string, f: RunFile): string[] {
  const p = `${dir}/${f.path}`;
  if (/\.\.|^\//.test(f.path)) throw new Error(`invalid file path: ${f.path}`);
  return [
    `mkdir -p "$(dirname ${shq(p)})"`,
    `printf %s ${shq(b64(f.content))} | base64 -d > ${shq(p)}`,
  ];
}

/** JSON -> Scala literal (Int / Long / Double, String, Boolean, null, List, Map). */
export function jsonToScala(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") {
    if (Number.isInteger(v)) return Math.abs(v) > 2_147_483_647 ? `${v}L` : String(v);
    return String(v);
  }
  if (typeof v === "string")
    return `new String(java.util.Base64.getDecoder.decode("${b64(v)}"), "UTF-8")`;
  if (Array.isArray(v)) return `List(${v.map(jsonToScala).join(", ")})`;
  if (typeof v === "object")
    return `Map(${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${jsonToScala(k)} -> ${jsonToScala(x)}`)
      .join(", ")})`;
  return "null";
}

/** Generated Scala main that calls each function test in one JVM and prints nonce-tagged marker lines. */
export function scalaHarnessSource(tests: TestSpec[], nonce: string): string {
  const cases = tests
    .map(
      (t) =>
        `    run(${JSON.stringify(t.id)}) { ${t.entryPoint}(${(t.args ?? []).map(jsonToScala).join(", ")}) }`,
    )
    .join("\n");
  // String.raw keeps the Scala escapes literal; only ${nonce} / ${cases} are interpolated.
  return String.raw`import java.io.{ByteArrayOutputStream, PrintStream}
import java.util.Base64

object SocraHarness {
  private val real = System.out
  private def enc(s: String): String = Base64.getEncoder.encodeToString(s.getBytes("UTF-8"))
  private def esc(s: String): String = {
    val sb = new StringBuilder("\"")
    s.foreach {
      case '"' => sb.append("\\\"")
      case '\\' => sb.append("\\\\")
      case '\n' => sb.append("\\n")
      case '\r' => sb.append("\\r")
      case '\t' => sb.append("\\t")
      case c if c < ' ' => sb.append("\\u%04x".format(c.toInt))
      case c => sb.append(c)
    }
    sb.append("\"").toString
  }
  def j(x: Any): String = x match {
    case null => "null"
    case () => "null"
    case s: String => esc(s)
    case c: Char => esc(c.toString)
    case b: Boolean => b.toString
    case n: Int => n.toString
    case n: Long => n.toString
    case n: Short => n.toString
    case n: Byte => n.toString
    case n: Float => if (n.isNaN || n.isInfinite) "null" else n.toString
    case n: Double => if (n.isNaN || n.isInfinite) "null" else n.toString
    case n: BigInt => n.toString
    case n: BigDecimal => n.toString
    case o: Option[?] => o.fold("null")(j)
    case m: scala.collection.Map[?, ?] => m.map((k, v) => esc(k.toString) + ":" + j(v)).mkString("{", ",", "}")
    case it: Iterable[?] => it.map(j).mkString("[", ",", "]")
    case a: Array[?] => a.map(j).mkString("[", ",", "]")
    case p: Product => p.productIterator.map(j).mkString("[", ",", "]")
    case other => esc(other.toString)
  }
  private def run(id: String)(body: => Any): Unit = {
    val buf = new ByteArrayOutputStream()
    val ps = new PrintStream(buf, true, "UTF-8")
    val t0 = System.nanoTime()
    var ok = true
    var payload = ""
    try {
      val v = Console.withOut(ps) { Console.withErr(ps) { body } }
      payload = "{\"json\":" + j(v) + "}"
    } catch {
      case e: Throwable =>
        ok = false
        payload = "{\"error\":" + esc(e.toString.take(400)) + "}"
    }
    ps.flush()
    val ms = (System.nanoTime() - t0) / 1000000
    real.println("@@${nonce}:F:" + id.replaceAll("[^A-Za-z0-9_.-]", "_") + ":" + (if (ok) "1" else "0") + ":" + ms + ":" + enc(buf.toString("UTF-8").take(8192)) + ":" + enc(payload) + "@@")
    real.flush()
  }
  def main(args: Array[String]): Unit = {
${cases}
  }
}
`;
}

export interface ScalaJobInput {
  nonce: string;
  files: RunFile[];
  mode: "run" | "tests";
  stdin?: string;
  tests: TestSpec[];
  defaultTestTimeoutMs: number;
}

export const safeId = (id: string) => id.replace(/[^A-Za-z0-9_.-]/g, "_");

export function buildScalaScript(job: ScalaJobInput): string {
  const n = job.nonce;
  const L: string[] = ["set +e"];
  const base = "/work/src";
  for (const f of job.files) L.push(...writeFileCmd(base, f));
  const cli = "scala-cli";
  if (job.mode === "run") {
    L.push(`printf %s ${shq(b64(job.stdin ?? ""))} | base64 -d > /tmp/stdin.txt`);
    L.push(`cd ${base} && exec ${cli} run --server=false . < /tmp/stdin.txt`);
    return L.join("\n") + "\n";
  }
  const stdio = job.tests.filter((t) => t.kind === "stdio");
  const fn = job.tests.filter((t) => t.kind === "function");
  if (stdio.length > 0) {
    L.push(`cd ${base}`);
    L.push(`${cli} compile --server=false . > /tmp/c.out 2>&1; rc=$?`);
    L.push(
      `if [ $rc -ne 0 ]; then echo "@@${n}:COMPILE:$rc:$(base64 -w0 /tmp/c.out)@@"; exit 0; fi`,
    );
    stdio.forEach((t, i) => {
      const sec = Math.ceil((t.timeoutMs ?? job.defaultTestTimeoutMs) / 1000);
      L.push(`printf %s ${shq(b64(t.stdin ?? ""))} | base64 -d > /tmp/in${i}`);
      L.push(`s=$(date +%s%N)`);
      L.push(
        `timeout -s KILL ${sec} ${cli} run --server=false . < /tmp/in${i} > /tmp/o${i} 2> /tmp/e${i}; rc=$?`,
      );
      L.push(`e=$(date +%s%N)`);
      L.push(
        `echo "@@${n}:T:${safeId(t.id)}:$rc:$(( (e - s) / 1000000 )):$(head -c 8192 /tmp/o${i} | base64 -w0):$(head -c 8192 /tmp/e${i} | base64 -w0)@@"`,
      );
    });
  }
  if (fn.length > 0) {
    const dir = "/work/fn";
    for (const f of job.files) L.push(...writeFileCmd(dir, f));
    L.push(...writeFileCmd(dir, { path: "SocraHarness.scala", content: scalaHarnessSource(fn, n) }));
    const sec = Math.ceil(fn.reduce((a, t) => a + (t.timeoutMs ?? job.defaultTestTimeoutMs), 0) / 1000);
    L.push(`cd ${dir}`);
    L.push(`${cli} compile --server=false . > /tmp/fc.out 2>&1; rc=$?`);
    L.push(
      `if [ $rc -ne 0 ]; then echo "@@${n}:COMPILE:$rc:$(base64 -w0 /tmp/fc.out)@@"; exit 0; fi`,
    );
    L.push(
      `timeout -s KILL ${sec} ${cli} run --server=false . --main-class SocraHarness > /tmp/fo 2> /tmp/fe; rc=$?`,
    );
    L.push(`grep -a '^@@${n}:F:' /tmp/fo`);
    L.push(`echo "@@${n}:FEND:$rc:$(head -c 8192 /tmp/fe | base64 -w0)@@"`);
  }
  return L.join("\n") + "\n";
}

export interface ParsedScalaTest {
  id: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  json?: unknown;
  hasJson: boolean;
  error?: string;
}

export interface ParsedScalaOutput {
  compileError: string | null;
  tests: Map<string, ParsedScalaTest>;
  /** Exit code of the function-test JVM (137 = killed by timeout). */
  fnExit: number | null;
  fnStderr: string;
}

const dec = (s: string) => Buffer.from(s, "base64").toString("utf8");

export function parseScalaOutput(stdout: string, nonce: string): ParsedScalaOutput {
  const out: ParsedScalaOutput = {
    compileError: null,
    tests: new Map(),
    fnExit: null,
    fnStderr: "",
  };
  const prefix = `@@${nonce}:`;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith(prefix) || !line.endsWith("@@")) continue;
    const parts = line.slice(prefix.length, -2).split(":");
    const kind = parts[0];
    if (kind === "COMPILE") {
      out.compileError = dec(parts.slice(2).join(":"));
    } else if (kind === "T") {
      const [, id, rc, ms, o, e] = parts;
      const code = Number(rc);
      out.tests.set(id!, {
        id: id!,
        ok: code === 0,
        exitCode: code,
        durationMs: Number(ms),
        stdout: dec(o ?? ""),
        stderr: dec(e ?? ""),
        hasJson: false,
      });
    } else if (kind === "F") {
      const [, id, ok, ms, o, p] = parts;
      let payload: { json?: unknown; error?: string } = {};
      try {
        payload = JSON.parse(dec(p ?? ""));
      } catch {
        payload = { error: "unreadable result" };
      }
      out.tests.set(id!, {
        id: id!,
        ok: ok === "1",
        exitCode: ok === "1" ? 0 : 1,
        durationMs: Number(ms),
        stdout: dec(o ?? ""),
        stderr: "",
        hasJson: ok === "1" && "json" in payload,
        json: payload.json,
        error: payload.error,
      });
    } else if (kind === "FEND") {
      out.fnExit = Number(parts[1]);
      out.fnStderr = dec(parts[2] ?? "");
    }
  }
  return out;
}
