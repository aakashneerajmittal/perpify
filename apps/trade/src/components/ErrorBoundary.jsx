/**
 * ErrorBoundary — a render-crash safety net so an investor never sees a blank page.
 * Any error thrown while rendering the tree below is caught here and replaced with a
 * branded "reload" fallback (inline styles, no theme/redux dependency so it works even
 * if those are what failed). Async/event errors don't unmount React, so this focuses
 * on the white-screen case: a render throw.
 */
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    try {
      // eslint-disable-next-line no-console
      console.error("[Perpify] render error:", error, info);
    } catch (e) {
      /* ignore */
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#080808",
          color: "#F0EDE8",
          display: "grid",
          placeItems: "center",
          fontFamily: "'Syne', system-ui, -apple-system, sans-serif",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 440 }}>
          <div
            style={{
              fontFamily: "'DM Mono', ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.18em",
              color: "#4F8EFF",
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            Perpify · Testnet
          </div>
          <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em", marginBottom: 10 }}>Something interrupted the app</div>
          <div style={{ color: "#888880", fontSize: 15, lineHeight: 1.55, marginBottom: 26 }}>
            A hiccup while loading — most often a cached older version. Reloading almost always fixes it.
          </div>
          <button
            onClick={() => {
              try {
                window.location.reload();
              } catch (e) {
                /* ignore */
              }
            }}
            style={{
              background: "#4F8EFF",
              color: "#08131f",
              border: "none",
              borderRadius: 8,
              padding: "12px 24px",
              fontFamily: "'Syne', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
