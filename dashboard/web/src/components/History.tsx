import { memo, useEffect, useRef } from "react";
import { store } from "../store/store";
import { bandForScore } from "../lib/bands";

const COL: Record<string, string> = { GREEN: "#22c55e", YELLOW: "#eab308", RED: "#ef4444", PURPLE: "#a855f7" };

function HistoryImpl({ compact }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const draw = () => {
      const c = canvasRef.current; if (!c) return;
      const hist = store.getState().history;
      const dpr = window.devicePixelRatio || 1;
      const h0 = compact ? 80 : 150;
      const w = (c.width = Math.floor(c.clientWidth * dpr));
      const h = (c.height = Math.floor(h0 * dpr));
      const ctx = c.getContext("2d"); if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "#22303f"; ctx.lineWidth = dpr; ctx.setLineDash([4 * dpr, 4 * dpr]);
      [30, 60, 85].forEach((g) => { const y = h - (g / 100) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); });
      ctx.setLineDash([]);
      if (!hist.length) { if (noteRef.current) noteRef.current.textContent = "history empty — skeleton"; return; }
      if (noteRef.current) noteRef.current.textContent = `${hist.length} samples · ${hist[hist.length - 1]![1]} now`;
      const t0 = hist[0]![0], t1 = hist[hist.length - 1]![0] || t0 + 1, span = Math.max(1, t1 - t0);
      for (let i = 1; i < hist.length; i++) {
        const x0 = ((hist[i - 1]![0] - t0) / span) * w, x1 = ((hist[i]![0] - t0) / span) * w;
        const y0 = h - (hist[i - 1]![1] / 100) * h, y1 = h - (hist[i]![1] / 100) * h;
        ctx.strokeStyle = COL[bandForScore(hist[i]![1])] || "#22c55e"; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    };
    let pending = false;
    const req = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; draw(); }); } };
    const unsub = store.subscribe(req);
    draw();
    window.addEventListener("resize", draw);
    return () => { unsub(); window.removeEventListener("resize", draw); };
  }, [compact]);

  return (
    <div className={compact ? "hist-compact" : ""}>
      <canvas className={`spark${compact ? " spark-compact" : ""}`} ref={canvasRef}
        style={compact ? { height: 80 } : undefined} />
      {!compact && <div className="histnote" ref={noteRef}>awaiting history…</div>}
      {compact && <div className="histnote" ref={noteRef} />}
    </div>
  );
}

export const History = memo(HistoryImpl);
