import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Warm ink-and-highlighter syntax colors via theme variables (--syn-*), so one
// highlight style serves both themes — no blue/purple defaults anywhere.
// Shared by the tracer editor and the C fork() editor.
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

export const warmSyntax = syntaxHighlighting(brutalistSyntax);

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

export const lightChrome = editorChrome(false);
export const darkChrome = editorChrome(true);
