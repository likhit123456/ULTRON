import { rc } from "../dev/rc";
import { memo } from "react";
import { useStore } from "../store/store";
import { useNow } from "../hooks/useNow";

// DETECT (Pi3a) -> GOVERN (Pi4) -> ALERT (Pi3b). A stage is "hot" if it fired
// in the last 3s. Latency shows bus->screen last + rolling p95.
function PipelineStripImpl() {
  rc("PipelineStrip");
  const pipeline = useStore((s) => s.pipeline);
  const latLast = useStore((s) => s.latencyLast);
  const latP95 = useStore((s) => s.latencyP95);
  const uncertain = useStore((s) => s.clockUncertaintyMs);
  const now = useNow(1000);
  const nowSec = Math.floor(now / 1000);
  const hot = (ts: number) => ts > 0 && nowSec - ts <= 3;

  const stages: Array<[string, number]> = [
    ["DETECT", pipeline.detect], ["GOVERN", pipeline.govern], ["ALERT", pipeline.alert],
  ];
  const pm = uncertain > 10 && isFinite(uncertain) ? " ±" : "";

  return (
    <div className="pipeline">
      {stages.map(([name, ts], i) => (
        <span key={name} style={{ display: "contents" }}>
          <span className={"stage" + (hot(ts) ? " hot" : "")}>
            <span className="dot" />{name}
          </span>
          {i < 2 && <span className="arrow">▶</span>}
        </span>
      ))}
      <span className="lat">
        bus → screen <b>{latLast || "—"}{latLast ? "ms" : ""}{pm}</b>
        {latP95 ? <> · p95 <b>{latP95}ms</b></> : null}
      </span>
    </div>
  );
}

export const PipelineStrip = memo(PipelineStripImpl);
