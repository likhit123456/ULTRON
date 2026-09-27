import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import App from "./App";
import { transport } from "./transport/transport";
import { store } from "./store/store";
import type { Band } from "./contracts/ws";

const q = new URLSearchParams(location.search);
// ?perf=1 => dev-only perf instrumentation (handler timings + Profiler counts).
if (q.get("perf")) {
  const g = window as unknown as { __ultronPerf: { handler: number[] }; __ultronRC: Record<string, number> };
  g.__ultronPerf = { handler: [] };
  g.__ultronRC = {};
}

// ?seed=<BAND> => dev-only static design snapshot; do NOT open a live socket.
const seedParam = q.get("seed");

// Dev-only handle for perf/screenshot harnesses (only when perf/seed present).
if (q.get("perf") || seedParam) {
  (window as unknown as { __ultron: unknown }).__ultron = { store };
}

if (import.meta.env.DEV && seedParam) {
  void import("./dev/seed").then(({ seedForDesign }) =>
    seedForDesign((seedParam.toUpperCase() as Band)));
} else {
  transport.start();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
