"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { SchedulerProvider, SchedulerId } from "@/lib/scheduler/types";
import { SCHEDULER_COLORS } from "@/lib/scheduler/colors";
import { ChartPoint } from "@/lib/scheduler/chart-utils";

interface RealtimeLineChartProps {
    title: string;
    points: ChartPoint[];
    seriesIds: SchedulerId[]; // whichever schedulers actually have data - never hard-coded
    schedulers: SchedulerProvider[]; // for looking up display names
    yAxisLabel: string;
    unit?: string;
    yDomain?: [number, number | "auto"];
}

/**
 * One reusable chart, driven entirely by props. CpuChart/MemoryChart/
 * ThroughputChart are thin wrappers around this - none of them, and
 * nothing in here, hard-codes "qwen" or any other scheduler id. Whatever
 * scheduler ids are present in `seriesIds` get a line, in that
 * scheduler's assigned color (see lib/scheduler/colors.ts).
 */
export function RealtimeLineChart({
    title,
    points,
    seriesIds,
    schedulers,
    yAxisLabel,
    unit = "",
    yDomain,
}: RealtimeLineChartProps) {
    const nameFor = (id: SchedulerId) => schedulers.find((s) => s.id === id)?.name ?? id;

    return (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
            <h3 className="mb-3 text-sm font-medium text-neutral-300">{title}</h3>

            {points.length === 0 || seriesIds.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-neutral-600">
                    Waiting for data&hellip;
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={points} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                        <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                            dataKey="time"
                            stroke="#525252"
                            tick={{ fill: "#737373", fontSize: 11 }}
                            label={{ value: "Time (s)", position: "insideBottom", offset: -2, fill: "#525252", fontSize: 11 }}
                        />
                        <YAxis
                            stroke="#525252"
                            tick={{ fill: "#737373", fontSize: 11 }}
                            domain={yDomain ?? [0, "auto"]}
                            width={44}
                            label={{ value: yAxisLabel, angle: -90, position: "insideLeft", fill: "#525252", fontSize: 11 }}
                        />
                        <Tooltip
                            contentStyle={{ background: "#171717", border: "1px solid #262626", borderRadius: 6, fontSize: 12 }}
                            labelStyle={{ color: "#a3a3a3" }}
                            labelFormatter={(value) => `t = ${value}s`}
                            formatter={(value, name) => [
                                `${typeof value === "number" ? value.toFixed(1) : value}${unit}`,
                                name,
                            ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12, color: "#a3a3a3" }} />
                        {seriesIds.map((id) => (
                            <Line
                                key={id}
                                type="monotone"
                                dataKey={id}
                                name={nameFor(id)}
                                stroke={SCHEDULER_COLORS[id]}
                                dot={false}
                                strokeWidth={2}
                                isAnimationActive={false}
                                connectNulls
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}