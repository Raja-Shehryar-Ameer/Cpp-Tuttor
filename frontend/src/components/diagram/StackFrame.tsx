import { CornerDownRight, CornerLeftDown } from "lucide-react";
import type { ReturnInfo } from "../../hooks/useReturnInfo";
import type { Frame } from "../../types/trace";
import { ValueBox } from "./ValueBox";

export function StackFrame({
  frame,
  active,
  returnInfo,
}: {
  frame: Frame;
  active: boolean;
  returnInfo?: ReturnInfo | null;
}) {
  return (
    <div className={`stack-frame ${active ? "active" : ""}`}>
      <div className="frame-title">
        {active && <CornerDownRight size={13} className="frame-tracker" aria-label="executing here" />}
        <span className="frame-name">{frame.functionName}()</span>
        <span className="frame-line">line {frame.line}</span>
      </div>
      {returnInfo && (
        <div className="return-bubble" key={`${frame.line}-${returnInfo.value}`}>
          <CornerLeftDown size={12} aria-hidden="true" />
          <span>
            {returnInfo.value !== null ? (
              <>
                <code>{returnInfo.functionName}()</code> returned <strong>{returnInfo.value}</strong>
                {returnInfo.intoLocal && <> → {returnInfo.intoLocal}</>}
              </>
            ) : (
              <>
                returned from <code>{returnInfo.functionName}()</code>
              </>
            )}
          </span>
        </div>
      )}
      {frame.locals.map((value) => (
        <ValueBox key={value.name} value={value} />
      ))}
      {frame.locals.length === 0 && <div className="empty-note">no locals</div>}
    </div>
  );
}
