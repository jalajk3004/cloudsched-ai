"use client";

import { useEffect, useRef, useState } from "react";
import { schedulers, getConnectedSchedulers } from "@/lib/scheduler/registry";
import { generateNextMockMetrics, advanceMockTasks } from "@/lib/simulation/mock-data";
import {
    SchedulerProvider,
    SchedulerMetrics,
    SchedulerId,
    Task,
    SchedulerEvent,
    ConnectionStatus,
} from "@/lib/scheduler/types";

const TICK_MS = 1000;
const MAX_HISTORY_PER_SCHEDULER = 900; // 15 minutes at 1 sample/sec

export interface SchedulerMetricsState {
    schedulers: SchedulerProvider[]; // ALL four, including disconnected ones (for cards)
    metrics: Partial<Record<SchedulerId, SchedulerMetrics[]>>; // history, connected schedulers only
    tasks: Task[];
    events: SchedulerEvent[];
    connectionStatus: ConnectionStatus;
    isPaused: boolean;
    setPaused: (paused: boolean) => void;
}

let eventIdCounter = 0;
function pushEvent(events: SchedulerEvent[], event: Omit<SchedulerEvent, "id">): SchedulerEvent[] {
    eventIdCounter += 1;
    const withId: SchedulerEvent = { ...event, id: `evt-${eventIdCounter}` };
    const MAX_EVENTS = 200;
    const next = [...events, withId];
    return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

/**
 * The single data-layer hook every dashboard component reads from.
 * No component calls fetch()/WebSocket code directly (Section 13) -
 * they all just call this hook and render what it returns.
 *
 * Right now this runs entirely in "demo" mode (mock data generated on a
 * client-side interval). When a real backend/WebSocket exists, only the
 * inside of this hook needs to change - the returned shape
 * (SchedulerMetricsState) stays the same, so no component below it needs
 * to be rewritten.
 */
export function useSchedulerMetrics(): SchedulerMetricsState {
    const [metrics, setMetrics] = useState<Partial<Record<SchedulerId, SchedulerMetrics[]>>>({});
    const [tasks, setTasks] = useState<Task[]>([]);
    const [events, setEvents] = useState<SchedulerEvent[]>([
        { id: "evt-0", timestamp: Date.now(), severity: "info", message: "Dashboard started in demo data mode." },
    ]);
    const [isPaused, setPaused] = useState(false);
    const isPausedRef = useRef(isPaused);
    isPausedRef.current = isPaused;

    useEffect(() => {
        const connected = getConnectedSchedulers();
        const connectedIds = connected.map((s) => s.id);

        const interval = setInterval(() => {
            if (isPausedRef.current) return;

            setMetrics((prevMetrics) => {
                const next = { ...prevMetrics };
                for (const scheduler of connected) {
                    const history = next[scheduler.id] ?? [];
                    const previous = history[history.length - 1];
                    const sample = generateNextMockMetrics(scheduler.id, previous);
                    const updatedHistory = [...history, sample];
                    next[scheduler.id] =
                        updatedHistory.length > MAX_HISTORY_PER_SCHEDULER
                            ? updatedHistory.slice(updatedHistory.length - MAX_HISTORY_PER_SCHEDULER)
                            : updatedHistory;
                }
                return next;
            });

            setTasks((prevTasks) => advanceMockTasks(prevTasks, connectedIds));
        }, TICK_MS);

        return () => clearInterval(interval);
    }, []);

    // occasional event log entries, separate/slower interval so the log
    // doesn't spam a new line every single second
    useEffect(() => {
        const connectedIds = getConnectedSchedulers().map((s) => s.id);
        const interval = setInterval(() => {
            if (isPausedRef.current || connectedIds.length === 0) return;
            if (Math.random() > 0.5) return; // skip some ticks so the log reads naturally

            const schedulerId = connectedIds[Math.floor(Math.random() * connectedIds.length)];
            const messages: { severity: SchedulerEvent["severity"]; message: string }[] = [
                { severity: "info", message: `Task scheduled by ${schedulerId}` },
                { severity: "success", message: `Task completed under ${schedulerId}` },
                { severity: "warning", message: `Task rejected by ${schedulerId}` },
            ];
            const picked = messages[Math.floor(Math.random() * messages.length)];
            setEvents((prev) => pushEvent(prev, { timestamp: Date.now(), schedulerId, ...picked }));
        }, TICK_MS * 2);

        return () => clearInterval(interval);
    }, []);

    return {
        schedulers, // full list, including disconnected - cards need to show "Not Connected"
        metrics,
        tasks,
        events,
        connectionStatus: "demo",
        isPaused,
        setPaused,
    };
}