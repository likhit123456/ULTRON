import { Header } from "../components/Header";
import { DegradedBanner } from "../components/DegradedBanner";
import { RiskPanel } from "../components/RiskPanel";
import { HardwareTwin } from "../components/HardwareTwin";
import { PipelineStrip } from "../components/PipelineStrip";
import { IndicatorTwin } from "../components/IndicatorTwin";
import { NodeTiles } from "../components/NodeTiles";
import { History } from "../components/History";
import { EventFeed } from "../components/EventFeed";
import { CommandConsole } from "../components/CommandConsole";
import { QuickControls } from "../components/QuickControls";
import { IoTGraph } from "../components/IoTGraph";
import { StatusStrip } from "../components/StatusStrip";

export default function OperatorView() {
  return (
    <div className="ops-layout">
      <Header />
      <DegradedBanner />
      <main className="ops-grid">
        <section className="panel ops-scoring">
          <span className="label">SCORING</span>
          <RiskPanel />
          <History compact />
          <PipelineStrip />
          <IndicatorTwin />
        </section>

        <section className="panel ops-console">
          <span className="label">COMMAND CONSOLE</span>
          <CommandConsole />
        </section>

        <section className="panel ops-devmap">
          <span className="label">MY DEVICE MAP</span>
          <HardwareTwin />
          <NodeTiles compact />
        </section>

        <section className="panel ops-events">
          <span className="label">EVENTS HAPPENING</span>
          <EventFeed />
        </section>

        <section className="panel ops-controls">
          <span className="label">QUICK CONTROLS</span>
          <QuickControls />
        </section>

        <section className="panel ops-iot">
          <span className="label">EXTERNAL IoT ARCHITECTURE</span>
          <IoTGraph />
        </section>
      </main>
      <StatusStrip />
    </div>
  );
}
