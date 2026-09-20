import { ServerConfig } from '../engine/simulation-engine';

/**
 * Named server-farm configurations, all used for direct comparison
 * against the SAME workload. Two of these ("one-large" and "many-small")
 * deliberately have the exact same TOTAL capacity as "four-mixed" (48
 * CPU / 98304 MB combined) - so any difference in results between them
 * is caused purely by how that capacity is split up, not by there being
 * more or less total room overall. "one-small" is intentionally
 * under-provisioned, to show what heavy rejection actually looks like.
 */
export const SERVER_CONFIGS: Record<string, ServerConfig[]> = {
    'one-large': [
        { id: 's1', cpuCapacity: 48, memCapacity: 98304 }, // all capacity in a single server
    ],
    'one-small': [
        { id: 's1', cpuCapacity: 8, memCapacity: 16384 }, // deliberately too small - expect heavy rejection
    ],
    'four-mixed': [
        { id: 's1', cpuCapacity: 16, memCapacity: 32768 },
        { id: 's2', cpuCapacity: 16, memCapacity: 32768 },
        { id: 's3', cpuCapacity: 8, memCapacity: 16384 },
        { id: 's4', cpuCapacity: 8, memCapacity: 16384 },
    ], // this is the default config used by the other CLIs (run-baseline-cli.ts, etc.)
    'eight-small': [
        { id: 's1', cpuCapacity: 6, memCapacity: 12288 },
        { id: 's2', cpuCapacity: 6, memCapacity: 12288 },
        { id: 's3', cpuCapacity: 6, memCapacity: 12288 },
        { id: 's4', cpuCapacity: 6, memCapacity: 12288 },
        { id: 's5', cpuCapacity: 6, memCapacity: 12288 },
        { id: 's6', cpuCapacity: 6, memCapacity: 12288 },
        { id: 's7', cpuCapacity: 6, memCapacity: 12288 },
        { id: 's8', cpuCapacity: 6, memCapacity: 12288 },
    ], // same total capacity as "four-mixed" and "one-large", split across 8 equal servers
};