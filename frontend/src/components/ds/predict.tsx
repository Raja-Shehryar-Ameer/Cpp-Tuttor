// Predict mode's shared presentational layer: the question card, the
// score/streak chips, and the score hook. Each lab keeps its own gating —
// the three players advance different cursors (frame idx / tick / step).

import { Target } from "lucide-react";
import { useEffect, useState } from "react";
import type { Quiz } from "../../ds/engine";

export interface PredictState {
  asked: number;
  correct: number;
  streak: number;
  best: number;
}

const FRESH: PredictState = { asked: 0, correct: 0, streak: 0, best: 0 };

export function usePredictScore(): {
  state: PredictState;
  answer: (ok: boolean) => void;
  reset: () => void;
} {
  const [state, setState] = useState<PredictState>(FRESH);
  return {
    state,
    answer: (ok) =>
      setState((s) => ({
        asked: s.asked + 1,
        correct: s.correct + (ok ? 1 : 0),
        streak: ok ? s.streak + 1 : 0,
        best: Math.max(s.best, ok ? s.streak + 1 : s.streak),
      })),
    reset: () => setState(FRESH),
  };
}

export function PredictChips({ state }: { state: PredictState }) {
  if (state.asked === 0) return null;
  return (
    <>
      <span className="ds-chip quiz-chip">score {state.correct} / {state.asked}</span>
      <span className="ds-chip quiz-chip">streak {state.streak}{state.best > state.streak ? ` (best ${state.best})` : ""}</span>
    </>
  );
}

/** One question: choices → grade (right/wrong colored) → explanation → Continue. */
export function QuizPanel({
  quiz,
  onAnswer,
  onContinue,
}: {
  quiz: Quiz;
  onAnswer: (ok: boolean) => void;
  onContinue: () => void;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  useEffect(() => setChosen(null), [quiz]);
  return (
    <div className="quiz-panel" role="group" aria-label="predict the next step">
      <span className="quiz-icon">
        <Target size={16} aria-hidden="true" />
      </span>
      <div className="quiz-body">
        <p className="quiz-prompt">{quiz.prompt}</p>
        <div className="quiz-choices">
          {quiz.choices.map((choice, i) => (
            <button
              key={i}
              disabled={chosen !== null}
              className={
                chosen === null ? "" : i === quiz.answer ? "quiz-right" : i === chosen ? "quiz-wrong" : "quiz-dim"
              }
              onClick={() => {
                setChosen(i);
                onAnswer(i === quiz.answer);
              }}
            >
              {choice}
            </button>
          ))}
        </div>
        {chosen !== null && (
          <div className="quiz-after">
            <p className="quiz-explain">
              <strong>{chosen === quiz.answer ? "Correct." : "Not quite."}</strong> {quiz.explain}
            </p>
            <button className="primary" onClick={onContinue} autoFocus>
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
