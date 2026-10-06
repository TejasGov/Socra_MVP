"use client";

import { useMemo } from "react";
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
    color: "#2f6f68",
    fontWeight: "500",
  },
  { tag: [t.string, t.special(t.string)], color: "#8a4b0f" },
  { tag: [t.number, t.bool, t.null], color: "#2b5784" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6b7371", fontStyle: "italic" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "#1b1f1e",
    fontWeight: "500",
  },
  { tag: [t.definition(t.variableName)], color: "#1b1f1e" },
  { tag: [t.typeName, t.className], color: "#2c6a3f" },
  { tag: [t.operator, t.punctuation], color: "#535b59" },
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
