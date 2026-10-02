import { SchedulerId, SchedulerMetrics } from "./types";

/** One numeric field from SchedulerMetrics, merged across schedulers. */
export type ChartPoint = { time: number } & Partial<Record<SchedulerId, number>>;

type NumericMetricKey = {
    [K in keyof SchedulerMetrics]: SchedulerMetrics[K] extends number ? K : never;
}[keyof SchedulerMetrics];

/**
 * Turns { baseline: [...], qwen: [...] } (separate arrays, one per
 * scheduler) into ONE merged array recharts can plot multiple lines
 * from: [{ time: 0, baseline: 68, qwen: 74 }, { time: 1, ... }, ...].
 *
 * This is the ONLY place that needs to know how metrics histories are
 * shaped - every chart just calls this with the field it cares about
 * (cpuUtilizationPct, memUtilizationPct, throughput, ...) and gets back
 * something recharts can render directly, for however many schedulers
 * happen to be connected right now.
 */
export function buildTimeSeries(
    metrics: Partial<Record<SchedulerId, SchedulerMetrics[]>>,
    metricKey: NumericMetricKey,
): { points: ChartPoint[]; seriesIds: SchedulerId[] } {
    const seriesIds = (Object.keys(metrics) as SchedulerId[]).filter((id) => (metrics[id]?.length ?? 0) > 0);
    const maxLength = Math.max(0, ...seriesIds.map((id) => metrics[id]?.length ?? 0));

    const points: ChartPoint[] = [];
    for (let i = 0; i < maxLength; i++) {
        const point: ChartPoint = { time: i };
        for (const id of seriesIds) {
            const sample = metrics[id]?.[i];
            if (sample) point[id] = sample[metricKey] as number;
        }
        points.push(point);
    }
    return { points, seriesIds };
}