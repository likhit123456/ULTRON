import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import App from "./App";
import { transport } from "./transport/transport";
import { store } from "./store/store";
import type { Band } from "./contracts/ws";

const q = new URLSearchParams(location.search);
if (q.get("perf")) {
  const g = window as unknown as { __ultronPerf: { handler: number[] }; __ultronRC: Record<string, number> };
  g.__ultronPerf = { handler: [] };
  g.__ultronRC = {};
}

const seedParam = q.get("seed");

if (q.get("perf") || seedParam) {
  (window as unknown as { __ultron: unknown }).__ultron = { store };
}

if (import.meta.env.DEV && seedParam) {
  void import("./dev/seed").then(({ seedForDesign }) =>
    seedForDesign((seedParam.toUpperCase() as Band)));
} else {
  // Start transport only when auth reaches "ready"
  const unsub = store.subscribe(() => {
    if (store.getState().authPhase === "ready") {
      unsub();
      transport.start();
    }
  });
  // Also start immediately if already ready (e.g., cookie still valid)
  if (store.getState().authPhase === "ready") {
    unsub();
    transport.start();
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
