import type { Frame } from "../../types/trace";
import { ValueBox } from "./ValueBox";

export function StackFrame({ frame, active }: { frame: Frame; active: boolean }) {
  return (
    <div className={`stack-frame ${active ? "active" : ""}`}>
      <div className="frame-title">
        {frame.functionName}
        <span className="frame-line">line {frame.line}</span>
      </div>
      {frame.locals.map((value) => (
        <ValueBox key={value.name} value={value} />
      ))}
      {frame.locals.length === 0 && <div className="empty-note">no locals</div>}
    </div>
  );
}
