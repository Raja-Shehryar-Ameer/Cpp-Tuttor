import { cpp } from "@codemirror/lang-cpp";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
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

const extensions = [cpp(), highlightField];

export function EditorPane({
  code,
  onChange,
}: {
  code: string;
  onChange: (code: string) => void;
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
      theme="light"
    />
  );
}
