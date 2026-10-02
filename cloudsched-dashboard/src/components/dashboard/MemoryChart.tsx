import { RealtimeLineChart } from "./RealtimeLineChart";
import { buildTimeSeries } from "@/lib/scheduler/chart-utils";
import { SchedulerProvider, SchedulerMetrics, SchedulerId } from "@/lib/scheduler/types";

interface MemoryChartProps {
    metrics: Partial<Record<SchedulerId, SchedulerMetrics[]>>;
    schedulers: SchedulerProvider[];
}

export function MemoryChart({ metrics, schedulers }: MemoryChartProps) {
    const { points, seriesIds } = buildTimeSeries(metrics, "memUtilizationPct");

    return (
        <RealtimeLineChart
            title="Memory Utilization — Real Time"
            points={points}
            seriesIds={seriesIds}
            schedulers={schedulers}
            yAxisLabel="Memory %"
            unit="%"
            yDomain={[0, 100]}
        />
    );
}