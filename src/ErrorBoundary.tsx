import { Component, ReactNode } from "react";
import { useLrcStore } from "./stores/useLrcStore";
import { useI18nStore } from "./stores/useI18nStore";
import { saveRecoverySnapshot } from "./utils/recovery";

interface Props { children: ReactNode; onReload?: () => void }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  componentDidCatch(): void {
    const document = useLrcStore.getState();
    if (!document.isDirty) return;
    saveRecoverySnapshot(
      document.doc,
      document.lrcPath,
      document.audioPath,
      null,
      null,
      undefined,
      document._documentSession,
      document._editRevision,
      document._lrcFileHash,
    );
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace", background: "#1c1c1e", color: "#ff453a", height: "100vh" }}>
          <h2 style={{ marginBottom: 12 }}>렌더링 에러</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button type="button" onClick={this.props.onReload ?? (() => window.location.reload())}>
            {useI18nStore.getState().t.devicePicker.refresh}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
