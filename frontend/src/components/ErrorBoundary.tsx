import { RotateCcw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Last line of defense: a rendering bug anywhere below (a malformed trace, an
 * unexpected engine state) shows a friendly recovery card instead of a white
 * screen, and one click gets the user back to work.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Shinso crashed while rendering:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-card" role="alert">
        <TriangleAlert size={28} aria-hidden="true" />
        <h2>Something broke while drawing</h2>
        <p>
          The visualizer hit an unexpected state and stopped to avoid showing you something wrong.
        </p>
        <pre>{this.state.error.message}</pre>
        <button className="primary" onClick={() => window.location.reload()}>
          <RotateCcw size={14} aria-hidden="true" /> Reload Shinso
        </button>
      </div>
    );
  }
}
