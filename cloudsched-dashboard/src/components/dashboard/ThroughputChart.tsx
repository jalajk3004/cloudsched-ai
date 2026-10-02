import { RealtimeLineChart } from "./RealtimeLineChart";
import { buildTimeSeries } from "@/lib/scheduler/chart-utils";
import { SchedulerProvider, SchedulerMetrics, SchedulerId } from "@/lib/scheduler/types";

interface ThroughputChartProps {
    metrics: Partial<Record<SchedulerId, SchedulerMetrics[]>>;
    schedulers: SchedulerProvider[];
}

export function ThroughputChart({ metrics, schedulers }: ThroughputChartProps) {
    const { points, seriesIds } = buildTimeSeries(metrics, "throughput");

    return (
        <RealtimeLineChart
            title="Tasks Processed / Second"
            points={points}
            seriesIds={seriesIds}
            schedulers={schedulers}
            yAxisLabel="Tasks/s"
            unit="/s"
        />
    );
}