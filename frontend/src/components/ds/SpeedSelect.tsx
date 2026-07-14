import { Gauge } from "lucide-react";

export interface SpeedOption {
  label: string;
  ms: number;
}

/** Default playback speeds shared by the lab players. DSPage passes its own
    slower table (its FLIP glides need 600ms+ per step to finish cleanly). */
export const LAB_SPEEDS: SpeedOption[] = [
  { label: "0.5×", ms: 1600 },
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
];

/** Playback-speed dropdown for the lab transports: a centered gauge icon next
    to a native select (same precedent as the tracer's Controls). `speed` is an
    index into `speeds`. */
export function SpeedSelect({
  speed,
  onChange,
  speeds = LAB_SPEEDS,
}: {
  speed: number;
  onChange: (index: number) => void;
  speeds?: SpeedOption[];
}) {
  return (
    <label className="speed-select" title="playback speed">
      <Gauge size={13} aria-hidden="true" />
      <select value={speed} onChange={(e) => onChange(Number(e.target.value))} aria-label="playback speed">
        {speeds.map((s, i) => (
          <option key={s.label} value={i}>{s.label}</option>
        ))}
      </select>
    </label>
  );
}
