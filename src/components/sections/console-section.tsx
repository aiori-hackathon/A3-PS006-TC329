"use client";

import { useLabStore } from "@/store/lab-store";
import { RouteDiagram } from "@/components/lab/route-diagram";
import { ControllerCard, ReplicaCard } from "@/components/lab/station-cards";
import { Controls } from "@/components/lab/controls";
import { Telemetry } from "@/components/lab/telemetry";
import { AuditTape } from "@/components/lab/audit-tape";

/** Section 1 — the live console. */
export function ConsoleSection() {
  const replicas = useLabStore((s) => s.replicas);
  const ready = useLabStore((s) => s.ready);

  if (!ready) {
    return (
      <div className="grid gap-4 lg:grid-cols-3" aria-busy>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="panel min-h-32 animate-pulse" aria-hidden />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <RouteDiagram />
      <div className="grid min-w-0 gap-4 md:grid-cols-2 md:[grid-template-columns:minmax(0,1fr)_minmax(0,1.15fr)] xl:[grid-template-columns:minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
        <ControllerCard />
        <div className="grid min-w-0 content-start gap-4">
          <ReplicaCard r={replicas.find((r) => r.id === "A")!} />
          <ReplicaCard r={replicas.find((r) => r.id === "B")!} />
        </div>
        <Controls />
      </div>
      <Telemetry />
      <AuditTape />
    </div>
  );
}
