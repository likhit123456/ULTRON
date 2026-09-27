import { lazy, Suspense, useEffect } from "react";
import { useStore } from "./store/store";
import OperatorView from "./views/OperatorView";

const BoothView = lazy(() => import("./views/BoothView"));

function useView(): "operator" | "booth" {
  const params = new URLSearchParams(location.search);
  return params.get("view") === "booth" ? "booth" : "operator";
}

export default function App() {
  const band = useStore((s) => s.band);
  useEffect(() => { document.documentElement.setAttribute("data-band", band); }, [band]);

  const view = useView();
  if (view === "booth") {
    return (
      <Suspense fallback={<div style={{ padding: 24 }} className="label">loading booth…</div>}>
        <BoothView />
      </Suspense>
    );
  }
  return <OperatorView />;
}
