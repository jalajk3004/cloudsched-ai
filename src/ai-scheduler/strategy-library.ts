import type { PolicyProposal } from './llm-provider';

export interface StrategyDef {
    description: string;
    weights: PolicyProposal['weights'];
}

/** Named, deterministic starting strategies. Evaluated with NO LLM involved. */
export const STRATEGY_LIBRARY: Record<string, StrategyDef> = {
    tight_packing: {
        description: 'Best-Fit-like: place the task where it fills the free CPU and memory most tightly.',
        weights: { cpuFit: 1, memoryFit: 1 },
    },
    tight_smallest_first: {
        description: 'Tight packing, and handle the smallest pending tasks first (more tasks fit, less waiting).',
        weights: { cpuFit: 1, memoryFit: 1, taskSize: -1 },
    },
    balanced_residual: {
        description: 'Keep leftover CPU and memory in proportion so no server is stranded with only one resource.',
        weights: { cpuFit: 0.5, memoryFit: 0.5, resourceBalance: 0.8, taskSize: -0.5 },
    },
    low_fragmentation: {
        description: 'Avoid leaving slivers too small for a typical task.',
        weights: { cpuFit: 0.6, memoryFit: 0.6, cpuFragmentation: -1, memoryFragmentation: -0.6, taskSize: -0.5 },
    },
    future_preserving: {
        description: 'Pick the placement after which the cluster can still host the most expected future tasks.',
        weights: { futureCapacity: 1, cpuFit: 0.3, memoryFit: 0.3, taskSize: -0.5 },
    },
    wait_aware_future: {
        description: 'Future-preserving, but also keep long-waiting and high-priority tasks from starving.',
        weights: { futureCapacity: 1, cpuFit: 0.3, memoryFit: 0.3, taskSize: -0.3, taskWaitTime: 0.5, priority: 0.3 },
    },
    best_fit_exact: {
        description: 'EXACT replica of the Best-Fit baseline (smallest normalized residual). A starting point, not a goal.',
        weights: { normLeftover: -1 },
    },
};

/** baseStrategy weights, with the proposal's own weights layered on top. */
export function resolveWeights(p: PolicyProposal): PolicyProposal['weights'] {
    const base = p.baseStrategy && Object.prototype.hasOwnProperty.call(STRATEGY_LIBRARY, p.baseStrategy)
        ? STRATEGY_LIBRARY[p.baseStrategy].weights
        : {};
    return { ...base, ...p.weights };
}