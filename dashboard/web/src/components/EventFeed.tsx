import { memo, useCallback, useEffect, useRef } from "react";
import { store, useStore } from "../store/store";
import type { UEvent } from "../store/store";
import { transport } from "../transport/transport";
import { utcTime } from "../lib/format";
import { useReducedMotion } from "../hooks/useNow";

const KIND_ICON: Record<string, string> = {
  alert: "▲", suricata: "◆", wifi: "◇", lan: "●", tripwire: "⚡", band: "◉",
};
const NODE_SHORT: Record<string, string> = {
  pi4: "GOV", pi3a: "DET", pi3b: "ALR", esp32: "ESP",
};
const FILTERS = ["all", "alerts", "suricata", "lan", "wifi", "tripwire", "unacked"] as const;

const EventRow = memo(function EventRow({ e, isNew }: { e: UEvent; isNew: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!isNew || reduce || !ref.current) return;
    ref.current.animate(
      [{ transform: "translateY(-6px)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 180, easing: "cubic-bezier(0.22,0.61,0.36,1)" }
    );
  }, [isNew, reduce]);

  return (
    <div className={`ev-row sev-${e.sev}`} ref={ref}>
      <span className="ev-bar" />
      <span className="ev-time num">{utcTime(e.ts)}</span>
      <span className={`ev-node node-${e.node}`}>{NODE_SHORT[e.node] || e.node}</span>
      <span className="ev-icon" title={e.kind}>{KIND_ICON[e.kind] || "·"}</span>
      <span className="ev-summary">{e.summary}</span>
      {e.derived && <span className="ev-derived" title="Derived severity">~</span>}
      {e.alertId && (
        <button className="ackbtn ev-ack" disabled={e.ack}
          onClick={() => transport.sendAck(e.alertId!)}>
          {e.ack ? "ACKED" : "ACK"}
        </button>
      )}
      {e.ack && e.ackTs && <span className="ev-stamp">ACK · {utcTime(e.ackTs)}</span>}
    </div>
  );
});

function EventFeedImpl() {
  const events = useStore((s) => s.events);
  const filter = useStore((s) => s.eventFilter);
  const topId = useRef<string | null>(null);

  const filtered = useCallback(() => {
    if (filter === "all") return events;
    if (filter === "unacked") return events.filter((e) => e.alertId && !e.ack);
    if (filter === "alerts") return events.filter((e) => e.kind === "alert");
    return events.filter((e) => e.kind === filter);
  }, [events, filter]);

  const shown = filtered().slice(0, 200);
  const isNewTop = shown[0] ? shown[0].id !== topId.current : false;
  topId.current = shown[0]?.id ?? null;

  if (!events.length) {
    return (
      <div className="ev-feed">
        <div className="ev-filters">
          {FILTERS.map((f) => (
            <button key={f} className={`ev-chip${filter === f ? " active" : ""}`}
              onClick={() => { store.setEventFilter(f); }}>
              {f}
            </button>
          ))}
        </div>
        <div className="empty">No alerts — all quiet in the sensor mesh</div>
      </div>
    );
  }

  return (
    <div className="ev-feed">
      <div className="ev-filters">
        {FILTERS.map((f) => (
          <button key={f} className={`ev-chip${filter === f ? " active" : ""}`}
            onClick={() => { store.setEventFilter(f); }}>
            {f}
          </button>
        ))}
      </div>
      <div className="ev-scroll">
        {shown.map((e, i) => (
          <EventRow key={e.id} e={e} isNew={i === 0 && isNewTop} />
        ))}
      </div>
    </div>
  );
}

export const EventFeed = memo(EventFeedImpl);
