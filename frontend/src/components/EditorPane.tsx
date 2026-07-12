import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { useTraceStore } from "../store/traceStore";

const setHighlight = StateEffect.define<number | null>();

const lineDeco = Decoration.line({ class: "cm-current-step-line" });

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHighlight)) {
        if (effect.value === null || effect.value < 1 || effect.value > tr.state.doc.lines) {
          next = Decoration.none;
        } else {
          next = Decoration.set([lineDeco.range(tr.state.doc.line(effect.value).from)]);
        }
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Warm ink-and-highlighter syntax colors via theme variables (--syn-*), so one
// highlight style serves both themes — no blue/purple defaults anywhere.
const brutalistSyntax = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--syn-keyword)", fontWeight: "600" },
  { tag: [tags.typeName, tags.standard(tags.typeName), tags.namespace], color: "var(--syn-type)" },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: "var(--syn-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syn-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syn-comment)" },
  { tag: [tags.processingInstruction, tags.meta, tags.macroName], color: "var(--syn-meta)" },
  { tag: tags.function(tags.variableName), color: "var(--text)", fontWeight: "600" },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: "var(--text)" },
  { tag: tags.variableName, color: "var(--text)" },
]);

const editorChrome = (dark: boolean) =>
  EditorView.theme(
    {
      "&": { backgroundColor: "transparent" },
      ".cm-content": { caretColor: "var(--text)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--accent-soft)",
      },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-gutters": { backgroundColor: "var(--panel-2)", color: "var(--muted)", border: "none" },
      ".cm-activeLineGutter": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
    },
    { dark },
  );

const lightChrome = editorChrome(false);
const darkChrome = editorChrome(true);

const extensions = [cpp(), highlightField, syntaxHighlighting(brutalistSyntax)];

export function EditorPane({
  code,
  onChange,
  theme,
}: {
  code: string;
  onChange: (code: string) => void;
  theme: "light" | "dark";
}) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const trace = useTraceStore((s) => s.trace);
  const line = useTraceStore((s) => s.trace?.steps[s.currentStep]?.line ?? null);
  const playbackActive = trace !== null && trace.steps.length > 0;

  useEffect(() => {
    editorRef.current?.view?.dispatch({
      effects: setHighlight.of(playbackActive ? line : null),
    });
  }, [line, playbackActive]);

  return (
    <CodeMirror
      ref={editorRef}
      className="editor"
      value={playbackActive ? trace.sourceCode : code}
      onChange={onChange}
      readOnly={playbackActive}
      extensions={extensions}
      basicSetup={{ foldGutter: false, autocompletion: false }}
      theme={theme === "dark" ? darkChrome : lightChrome}
    />
  );
}
