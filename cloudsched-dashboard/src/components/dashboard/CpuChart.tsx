import { RealtimeLineChart } from "./RealtimeLineChart";
import { buildTimeSeries } from "@/lib/scheduler/chart-utils";
import { SchedulerProvider, SchedulerMetrics, SchedulerId } from "@/lib/scheduler/types";

interface CpuChartProps {
    metrics: Partial<Record<SchedulerId, SchedulerMetrics[]>>;
    schedulers: SchedulerProvider[];
}

export function CpuChart({ metrics, schedulers }: CpuChartProps) {
    const { points, seriesIds } = buildTimeSeries(metrics, "cpuUtilizationPct");

    return (
        <RealtimeLineChart
            title="CPU Utilization — Real Time"
            points={points}
            seriesIds={seriesIds}
            schedulers={schedulers}
            yAxisLabel="CPU %"
            unit="%"
            yDomain={[0, 100]}
        />
    );
}