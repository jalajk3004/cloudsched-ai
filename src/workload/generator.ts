import seedrandom from 'seedrandom';
import { Task, Priority } from '../domain/types';

export type WorkloadScenario = 'balanced' | 'cpu-heavy' | 'mem-heavy' | 'burst' | 'mixed';

export interface WorkloadConfig {
  scenario: WorkloadScenario;
  taskCount: number;
  seed: string;
  cpuRange: [number, number];   // baseline range before scenario bias
  memRange: [number, number];
  durationRange: [number, number];
  simulationDuration: number;   // ticks — arrivals are spread across this window
  priorityWeights?: [number, number, number]; // weights for [low, med, high], default even
}

function randInt(rng: seedrandom.PRNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function weightedPriority(rng: seedrandom.PRNG, weights: [number, number, number]): Priority {
  const total = weights[0] + weights[1] + weights[2];
  let r = rng() * total;
  if (r < weights[0]) return 1;
  r -= weights[0];
  if (r < weights[1]) return 2;
  return 3;
}

/**
 * Deterministic: same (scenario, seed, config) always produces the exact
 * same task list, in the exact same order — this is what lets every
 * scheduler be compared on identical conditions, and what lets a run be
 * reproduced later from just its config.
 */
export function generateWorkload(config: WorkloadConfig): Task[] {
  const rng = seedrandom(config.seed);
  const weights = config.priorityWeights ?? [1, 1, 1];
  const tasks: Task[] = [];

  const [cpuLo, cpuHi] = config.cpuRange;
  const [memLo, memHi] = config.memRange;
  const [durLo, durHi] = config.durationRange;

  for (let i = 0; i < config.taskCount; i++) {
    let cpuRequired: number;
    let memRequired: number;

    switch (config.scenario) {
      case 'cpu-heavy':
        cpuRequired = randInt(rng, Math.round((cpuLo + cpuHi) / 2), cpuHi);
        memRequired = randInt(rng, memLo, Math.round((memLo + memHi) / 2));
        break;
      case 'mem-heavy':
        cpuRequired = randInt(rng, cpuLo, Math.round((cpuLo + cpuHi) / 2));
        memRequired = randInt(rng, Math.round((memLo + memHi) / 2), memHi);
        break;
      case 'balanced':
        cpuRequired = randInt(rng, Math.round(cpuLo + (cpuHi - cpuLo) * 0.35), Math.round(cpuLo + (cpuHi - cpuLo) * 0.65));
        memRequired = randInt(rng, Math.round(memLo + (memHi - memLo) * 0.35), Math.round(memLo + (memHi - memLo) * 0.65));
        break;
      case 'burst':
      case 'mixed':
      default:
        cpuRequired = randInt(rng, cpuLo, cpuHi);
        memRequired = randInt(rng, memLo, memHi);
        break;
    }

    let arrivalTime: number;
    if (config.scenario === 'burst') {
      // cluster arrivals into bursts separated by idle gaps
      const burstCount = Math.max(3, Math.round(config.taskCount / 15));
      const burstIndex = i % burstCount;
      const burstWindowStart = Math.round((burstIndex / burstCount) * config.simulationDuration);
      arrivalTime = burstWindowStart + randInt(rng, 0, 2); // tight cluster
      arrivalTime = Math.min(arrivalTime, config.simulationDuration - 1);
    } else {
      arrivalTime = randInt(rng, 0, Math.max(0, config.simulationDuration - 1));
    }

    tasks.push({
      id: `t${i}`,
      cpuRequired,
      memRequired,
      duration: randInt(rng, durLo, durHi),
      arrivalTime,
      priority: weightedPriority(rng, weights),
      status: 'pending',
    });
  }

  return tasks.sort((a, b) => a.arrivalTime - b.arrivalTime);
}
