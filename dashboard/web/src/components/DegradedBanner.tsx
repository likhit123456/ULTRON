import { memo } from "react";
import { useStore } from "../store/store";
import { ago } from "../lib/format";
import { useNow } from "../hooks/useNow";

function DegradedBannerImpl() {
  const conn = useStore((s) => s.conn);
  const degraded = useStore((s) => s.degraded);
  const scoreTs = useStore((s) => s.scoreTs);
  const now = useNow(1000);
  const show = degraded || conn !== "live";
  if (!show) return null;
  return (
    <div className="banner">
      MQTT DEGRADED — last data {ago(scoreTs, now)} ago; values held, not live.
    </div>
  );
}

export const DegradedBanner = memo(DegradedBannerImpl);
