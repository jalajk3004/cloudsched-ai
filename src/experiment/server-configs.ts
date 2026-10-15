import * as fs from 'fs';
import * as path from 'path';
import { ServerConfig } from '../engine/simulation-engine';
import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { Task } from '../domain/types';
import { OBJECTIVE } from '../metrics/metrics-engine';

/**
 * Named server-farm configurations, all used for direct comparison against the SAME workload.
 * one-large, four-mixed and six-equal have the same total capacity (48 CPU / 98304 MB),
 * so differences between them are caused by how capacity is split across servers.
 * one-small is intentionally under-provisioned. Every server has at least 8 CPU / 16384 MB,
 * so every generated task can fit on an otherwise idle server.
 */
export const SERVER_CONFIGS: Record<string, ServerConfig[]> = {
    'one-large': [
        { id: 's1', cpuCapacity: 48, memCapacity: 98304 },
    ],
    'one-small': [
        { id: 's1', cpuCapacity: 8, memCapacity: 16384 },
    ],
    'four-mixed': [
        { id: 's1', cpuCapacity: 16, memCapacity: 32768 },
        { id: 's2', cpuCapacity: 16, memCapacity: 32768 },
        { id: 's3', cpuCapacity: 8, memCapacity: 16384 },
        { id: 's4', cpuCapacity: 8, memCapacity: 16384 },
    ],
    'six-equal': [
        { id: 's1', cpuCapacity: 8, memCapacity: 16384 },
        { id: 's2', cpuCapacity: 8, memCapacity: 16384 },
        { id: 's3', cpuCapacity: 8, memCapacity: 16384 },
        { id: 's4', cpuCapacity: 8, memCapacity: 16384 },
        { id: 's5', cpuCapacity: 8, memCapacity: 16384 },
        { id: 's6', cpuCapacity: 8, memCapacity: 16384 },
    ],
};

// Default layout used by the experiment scripts.
// Copy the objects so an experiment cannot accidentally mutate the named preset.
export const DEFAULT_SERVERS: ServerConfig[] = SERVER_CONFIGS['four-mixed'].map(server => ({ ...server }));

export const WORKLOAD_PARAMS = {
    taskCount: Number(process.env.TASKS ?? 100),
    cpuRange: [1, 8] as [number, number],
    memRange: [512, 8192] as [number, number],
    durationRange: [2, 20] as [number, number],
    // Arrival window; the simulator continues running until tasks finish or its hard limit.
    simulationDuration: 100,
};

/** Stable seed names make a workload reproducible as long as the generator stays unchanged. */
export const experimentSeeds = {
    training: (scenario: WorkloadScenario, index: number) => `train-extra-${scenario}-${index}`,
    validation: (scenario: WorkloadScenario, index: number) => `val-${scenario}-${index}`,
    final: (scenario: WorkloadScenario, index: number) => `${scenario}-full-comparison-run${index}`,
};

export function buildTrainingWorkloads(scenario: WorkloadScenario, n: number): Task[][] {
    assertWorkloadCount(n, 'training');
    return Array.from({ length: n }, (_, k) =>
        generateWorkload({ scenario, seed: experimentSeeds.training(scenario, k), ...WORKLOAD_PARAMS }));
}

export function buildValidationWorkloads(scenario: WorkloadScenario, n: number): Task[][] {
    assertWorkloadCount(n, 'validation');
    return Array.from({ length: n }, (_, k) =>
        generateWorkload({ scenario, seed: experimentSeeds.validation(scenario, k), ...WORKLOAD_PARAMS }));
}

export function buildFinalWorkloads(scenario: WorkloadScenario, n: number): Task[][] {
    assertWorkloadCount(n, 'final evaluation');
    return Array.from({ length: n }, (_, r) =>
        generateWorkload({ scenario, seed: experimentSeeds.final(scenario, r), ...WORKLOAD_PARAMS }));
}

function assertWorkloadCount(n: number, label: string): void {
    if (!Number.isInteger(n) || n < 0) {
        throw new Error(`The ${label} workload count must be a non-negative integer; received ${n}.`);
    }
}

/**
 * Writes the configuration and seed manifest alongside the experiment results.
 * Extra fields are preserved, so callers can record scenario, counts and frozen policy.
 */
export function saveExperimentConfig(label: string, extra: Record<string, unknown> = {}): string {
    const dir = path.join('results', 'configs');
    fs.mkdirSync(dir, { recursive: true });

    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${label}-${safeTimestamp}.json`);
    const scenario = typeof extra.scenario === 'string'
        ? extra.scenario as WorkloadScenario
        : undefined;
    const trainingCount = typeof extra.trainingWorkloadCount === 'number'
        ? Math.max(0, extra.trainingWorkloadCount - 1)
        : undefined;
    const validationCount = typeof extra.validationWorkloadCount === 'number'
        ? extra.validationWorkloadCount
        : undefined;
    const finalCount = typeof extra.repeats === 'number' ? extra.repeats : undefined;

    const seedManifest = scenario ? {
        // The primary sample workload is generated separately by the CLI and is not included here.
        trainingExtra: trainingCount === undefined
            ? undefined
            : Array.from({ length: trainingCount }, (_, i) => experimentSeeds.training(scenario, i)),
        validation: validationCount === undefined
            ? undefined
            : Array.from({ length: validationCount }, (_, i) => experimentSeeds.validation(scenario, i)),
        final: finalCount === undefined
            ? undefined
            : Array.from({ length: finalCount }, (_, i) => experimentSeeds.final(scenario, i)),
    } : undefined;

    fs.writeFileSync(file, JSON.stringify({
        servers: DEFAULT_SERVERS,
        workload: WORKLOAD_PARAMS,
        objective: OBJECTIVE,
        seedNamespaces: {
            training: 'train-extra-*',
            validation: 'val-*',
            final: '*-full-comparison-run*',
        },
        ...(seedManifest ? { seedManifest } : {}),
        ...extra,
    }, null, 2));

    return file;
}
