import { SchedulerProvider, SchedulerMetrics } from "@/lib/scheduler/types";
import { Cpu, MemoryStick, CheckCircle2, XCircle, Clock, TimerReset } from "lucide-react";

interface SchedulerCardProps {
    scheduler: SchedulerProvider;
    latestMetrics?: SchedulerMetrics;
}

const STATUS_STYLES: Record<SchedulerProvider["status"], string> = {
    disconnected: "bg-neutral-800 text-neutral-500",
    idle: "bg-neutral-800 text-neutral-300",
    running: "bg-emerald-950 text-emerald-400",
    stopped: "bg-neutral-800 text-neutral-400",
};

const STATUS_LABEL: Record<SchedulerProvider["status"], string> = {
    disconnected: "Not Connected",
    idle: "Idle",
    running: "Running",
    stopped: "Stopped",
};

function MetricRow({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
    return (
        <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-neutral-500">
                <Icon className="h-3.5 w-3.5" />
                {label}
            </span>
            <span className="font-mono text-neutral-200">{value}</span>
        </div>
    );
}

export function SchedulerCard({ scheduler, latestMetrics }: SchedulerCardProps) {
    const disconnected = scheduler.status === "disconnected";

    return (
        <div
            className={`rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 ${disconnected ? "opacity-60" : ""
                }`}
        >
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-neutral-100">{scheduler.name}</h3>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[scheduler.status]}`}>
                    {STATUS_LABEL[scheduler.status]}
                </span>
            </div>

            {disconnected ? (
                <p className="text-sm text-neutral-600">Waiting for this scheduler to be registered.</p>
            ) : !latestMetrics ? (
                <p className="text-sm text-neutral-600">Waiting for first data point&hellip;</p>
            ) : (
                <div className="space-y-2">
                    <MetricRow icon={Cpu} label="CPU" value={`${latestMetrics.cpuUtilizationPct.toFixed(1)}%`} />
                    <MetricRow icon={MemoryStick} label="Memory" value={`${latestMetrics.memUtilizationPct.toFixed(1)}%`} />
                    <MetricRow icon={CheckCircle2} label="Scheduled" value={`${latestMetrics.successfullyScheduled}`} />
                    <MetricRow icon={XCircle} label="Rejected" value={`${latestMetrics.rejected}`} />
                    <MetricRow icon={Clock} label="Avg Wait" value={`${latestMetrics.avgWaitingTime.toFixed(1)}s`} />
                    <MetricRow icon={TimerReset} label="Avg Turnaround" value={`${latestMetrics.avgTurnaroundTime.toFixed(1)}s`} />
                </div>
            )}
        </div>
    );
}