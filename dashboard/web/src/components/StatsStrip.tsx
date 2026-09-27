import { rc } from "../dev/rc";
import { memo } from "react";
import { useStore } from "../store/store";

function StatsStripImpl() {
  rc("StatsStrip");
  const s = useStore((st) => ({
    events: st.eventCount, open: st.openCount, ackTotal: st.ackTotal,
    ackDone: st.ackDone, dev: st.layers.lanToday, conn: st.conn,
  }));
  const ackRate = s.ackTotal ? Math.round((s.ackDone / s.ackTotal) * 100) + "%" : "—";
  const cells = [
    { v: s.events, k: "events/24h" },
    { v: s.open, k: "alerts open" },
    { v: ackRate, k: "ack rate" },
    { v: s.conn === "offline" ? "—" : "100%", k: "uptime %" },
    { v: s.dev, k: "new devices/24h" },
  ];
  return (
    <div>
      <div className="stats">
        {cells.map((c) => (
          <div className="stat" key={c.k}><div className="v">{c.v}</div><div className="k label">{c.k}</div></div>
        ))}
      </div>
      <div className="decay">governance: −2 pts / 10s → baseline 0</div>
    </div>
  );
}

export const StatsStrip = memo(StatsStripImpl);
