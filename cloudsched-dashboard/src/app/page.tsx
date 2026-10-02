"use client";

import { useSchedulerMetrics } from "@/hooks/useSchedulerMetrics";
import { SchedulerCard } from "@/components/dashboard/SchedulerCard";
import { ConnectionStatus } from "@/components/dashboard/ConnectionStatus";
import { CpuChart } from "@/components/dashboard/CpuChart";
import { MemoryChart } from "@/components/dashboard/MemoryChart";
import { ThroughputChart } from "@/components/dashboard/ThroughputChart";
import { Activity } from "lucide-react";

export default function DashboardPage() {
  const { schedulers, metrics, connectionStatus } = useSchedulerMetrics();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-neutral-400" />
          <span className="text-sm font-semibold tracking-wide text-neutral-100">CloudSched-AI</span>
        </div>
        <ConnectionStatus status={connectionStatus} />
      </header>

      <main className="flex-1 px-6 py-6">
        <h1 className="mb-4 text-sm font-medium text-neutral-400">Scheduler Overview</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {schedulers.map((scheduler) => {
            const history = metrics[scheduler.id];
            const latest = history?.[history.length - 1];
            return <SchedulerCard key={scheduler.id} scheduler={scheduler} latestMetrics={latest} />;
          })}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <CpuChart metrics={metrics} schedulers={schedulers} />
          <MemoryChart metrics={metrics} schedulers={schedulers} />
        </div>

        <div className="mt-4">
          <ThroughputChart metrics={metrics} schedulers={schedulers} />
        </div>
      </main>
    </div>
  );
}