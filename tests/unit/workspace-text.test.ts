import { describe, expect, it } from "vitest";
import { withHardBreaks } from "../../src/components/workspace/markdown";
import { scrubHarnessText } from "../../src/server/runner/types";

describe("scrubHarnessText", () => {
  it("drops harness frames, their source lines and spec_in references", () => {
    const raw = [
      "Traceback (most recent call last):",
      '  File "/opt/socra/harness.py", line 12, in <module>',
      '    fn = getattr(m, spec_in["entryPoint"])',
      "           ^^^^^^^",
      '  File "main.py", line 3, in <module>',
      "    foo()",
      "AttributeError: module has no attribute 'running_totals'",
    ].join("\n");
    const out = scrubHarnessText(raw);
    expect(out).not.toMatch(/opt\/socra|spec_in|\^\^\^/);
    expect(out).toContain('File "main.py"');
    expect(out).toContain("AttributeError");
  });
});

describe("withHardBreaks", () => {
  it("keeps single newlines outside fenced code and leaves fences alone", () => {
    const out = withHardBreaks("Line 1\nLine 2\n\n```py\na\nb\n```\n");
    expect(out).toBe("Line 1  \nLine 2\n\n```py\na\nb\n```\n");
  });
});
