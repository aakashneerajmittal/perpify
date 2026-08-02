import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { Provider } from "react-redux";
import * as configureStore from "BL/redux/store/configureStore";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import clevertap from "clevertap-web-sdk";

// PERPIFY: third-party analytics (PostHog, CleverTap) disabled for the testnet — we don't
// ship their tracking, and their boot-time init can crash without real keys. Guarded so the
// app always boots; re-enable with real keys for production if wanted.
try {
  if (process.env.REACT_APP_PUBLIC_POSTHOG_KEY && process.env.REACT_APP_PUBLIC_POSTHOG_KEY !== "disabled") {
    posthog.init(process.env.REACT_APP_PUBLIC_POSTHOG_KEY, {
      api_host: process.env.REACT_APP_PUBLIC_POSTHOG_URL ?? "https://app.posthog.com"
    });
  }
} catch (e) { /* analytics off */ }

const container = document.getElementById("root") as HTMLElement;
const root = createRoot(container); // No need for non-null assertion operator in TypeScript
const store = configureStore.default;
try { clevertap.init("4WZ-9ZZ-7W7Z"); } catch (e) { /* analytics off */ }
root.render(
  <ErrorBoundary>
    <Provider store={store}>
      <PostHogProvider client={posthog}>
        <App />
      </PostHogProvider>
    </Provider>
  </ErrorBoundary>
);
