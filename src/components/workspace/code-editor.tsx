"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { scala } from "@codemirror/legacy-modes/mode/clike";
import type { WorkspaceLanguage } from "./types";

/** Light editor theme built on the design tokens (DESIGN_GUARDRAILS §5.7). */
const tokenTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-surface, #ffffff)",
    color: "var(--color-fg, #1b1f1e)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    lineHeight: "20px",
  },
  ".cm-line": { lineHeight: "20px" },
  ".cm-gutterElement": { lineHeight: "20px" },
  ".cm-content": { caretColor: "var(--color-fg, #1b1f1e)", padding: "8px 0" },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface, #ffffff)",
    color: "var(--color-fg-subtle, #6b7371)",
    borderRight: "1px solid var(--color-border, #e2e4e3)",
  },
  ".cm-activeLine": { backgroundColor: "var(--color-surface-2, #f3f4f3)" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--color-surface-2, #f3f4f3)",
    color: "var(--color-fg-muted, #535b59)",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--color-accent-subtle, #e8f1ef) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--color-fg, #1b1f1e)" },
});

/** Syntax colors: muted, AA on white, accent used sparingly for keywords. */
const highlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword],
    color: "var(--syntax-keyword)",
    fontWeight: "500",
  },
  { tag: [t.string, t.special(t.string)], color: "var(--syntax-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--syntax-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syntax-comment)", fontStyle: "italic" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--syntax-function)",
    fontWeight: "500",
  },
  { tag: [t.definition(t.variableName)], color: "var(--syntax-function)" },
  { tag: [t.typeName, t.className], color: "var(--syntax-type)" },
  { tag: [t.operator, t.punctuation], color: "var(--syntax-operator)" },
]);

function languageExtension(lang: WorkspaceLanguage | null): Extension[] {
  switch (lang) {
    case "PYTHON":
      return [python()];
    case "JAVASCRIPT":
      return [javascript()];
    case "SCALA":
      return [StreamLanguage.define(scala)];
    default:
      return [];
  }
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: WorkspaceLanguage | null;
  ariaLabel: string;
  readOnly?: boolean;
  /** Ctrl/Cmd+Enter inside the editor. */
  onRun?: () => void;
  height?: string;
  describedBy?: string;
}

export function CodeEditor({
  value,
  onChange,
  language,
  ariaLabel,
  readOnly,
  onRun,
  height = "360px",
  describedBy,
}: CodeEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const [ready, setReady] = useState(false);
  // CodeMirror skips measuring while the editor is off screen, which leaves the gutter's
  // line heights stale for wrapped lines. Re-measure whenever it scrolls into view.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) view.requestMeasure();
    });
    io.observe(view.dom);
    return () => io.disconnect();
  }, [ready]);

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      ...languageExtension(language),
      tokenTheme,
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      }),
    ];
    if (onRun) {
      exts.push(
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                onRun();
                return true;
              },
            },
          ]),
        ),
      );
    }
    return exts;
  }, [language, ariaLabel, describedBy, onRun]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      height={height}
      theme="none"
      onCreateEditor={(view) => {
        viewRef.current = view;
        setReady(true);
        // Re-measure once web fonts load so line heights and the gutter agree.
        requestAnimationFrame(() => view.requestMeasure());
        void document.fonts?.ready.then(() => view.requestMeasure());
      }}
      readOnly={readOnly}
      editable={!readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        tabSize: 4,
      }}
    />
  );
}
