
import {
  Scheduler,
  TaskView,
  ServerView,
  SchedulingDecision,
} from '../domain/types';
import {
  ConditionExpression,
  NumericExpression,
  PolicyFeature,
  PolicyProposal,
  ORDERING_FEATURES,
} from './llm-provider';
import { resolveWeights } from './strategy-library';

const HISTORY_LIMIT = 60;
const LOOKAHEAD_SAMPLES = 12;

type Shape = { id: string; cpu: number; mem: number };
type FeatureValues = Partial<Record<PolicyFeature, number>>;

const isOrdering = (f: string) =>
  f === 'taskDuration' || (ORDERING_FEATURES as readonly string[]).includes(f);

const median = (xs: number[], fallback: number): number => {
  if (xs.length === 0) return fallback;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function evaluateCondition(
  condition: ConditionExpression,
  features: FeatureValues,
): boolean {
  switch (condition.type) {
    case 'compare': {
      const left = evaluateExpression(condition.left, features);
      const right = evaluateExpression(condition.right, features);

      switch (condition.op) {
        case 'lt': return left < right;
        case 'lte': return left <= right;
        case 'gt': return left > right;
        case 'gte': return left >= right;
        case 'eq': return left === right;
        case 'neq': return left !== right;
      }
    }

    case 'boolean':
      return condition.op === 'and'
        ? evaluateCondition(condition.left, features) &&
        evaluateCondition(condition.right, features)
        : evaluateCondition(condition.left, features) ||
        evaluateCondition(condition.right, features);

    case 'not':
      return !evaluateCondition(condition.value, features);
  }
}

function evaluateExpression(
  expression: NumericExpression,
  features: FeatureValues,
): number {
  switch (expression.type) {
    case 'constant':
      return expression.value;

    case 'feature':
      return features[expression.name] ?? 0;

    case 'arithmetic': {
      const left = evaluateExpression(expression.left, features);
      const right = evaluateExpression(expression.right, features);

      switch (expression.op) {
        case 'add': return left + right;
        case 'subtract': return left - right;
        case 'multiply': return left * right;
        case 'divide':
          return Math.abs(right) < 1e-12 ? 0 : left / right;
      }
    }

    case 'if':
      return evaluateCondition(expression.condition, features)
        ? evaluateExpression(expression.then, features)
        : evaluateExpression(expression.else, features);
  }
}

export class PolicyInterpreterScheduler implements Scheduler {
  readonly name: string;

  private weights: PolicyProposal['weights'];
  private recent: Shape[] = [];
  private seenIds = new Set<string>();
  private lastTick = -1;

  constructor(private policy: PolicyProposal) {
    this.name = `ai-scheduler(${policy.policyName})`;
    this.weights = resolveWeights(policy);
  }

  schedule(
    pendingTasks: ReadonlyArray<TaskView>,
    servers: ReadonlyArray<ServerView>,
    currentTick: number,
  ): SchedulingDecision[] {
    if (currentTick < this.lastTick) {
      this.recent = [];
      this.seenIds.clear();
    }
    this.lastTick = currentTick;

    for (const task of pendingTasks) {
      if (this.seenIds.has(task.id)) continue;

      this.seenIds.add(task.id);
      this.recent.push({
        id: task.id,
        cpu: task.cpuRequired,
        mem: task.memRequired,
      });

      if (this.recent.length > HISTORY_LIMIT) this.recent.shift();
    }

    const maxCpuCap = Math.max(1, ...servers.map(s => s.cpuCapacity));
    const maxMemCap = Math.max(1, ...servers.map(s => s.memCapacity));
    const maxWait = Math.max(
      1,
      ...pendingTasks.map(t => currentTick - t.arrivalTime),
    );

    const typicalCpu = median(this.recent.map(r => r.cpu), 1);
    const typicalMem = median(this.recent.map(r => r.mem), 1);
    const wFuture = this.weights.futureCapacity ?? 0;

    const k = Math.min(LOOKAHEAD_SAMPLES, this.recent.length);
    const sample = Array.from({ length: k }, (_, i) =>
      this.recent[Math.floor(((i + 0.5) * this.recent.length) / k)],
    ).sort(
      (a, b) =>
        b.cpu / maxCpuCap + b.mem / maxMemCap -
        (a.cpu / maxCpuCap + a.mem / maxMemCap),
    );

    const freeCpu = new Map(
      servers.map(s => [s.id, s.cpuCapacity - s.cpuUsed]),
    );
    const freeMem = new Map(
      servers.map(s => [s.id, s.memCapacity - s.memUsed]),
    );

    const preferHigh = this.policy.tieBreak === 'highest_server_index';

    const ordered = this.orderTasks(
      pendingTasks,
      currentTick,
      maxWait,
      maxCpuCap,
      maxMemCap,
    );

    const decisions: SchedulingDecision[] = [];

    for (const task of ordered) {
      let bestId: string | null = null;
      let bestScore = -Infinity;

      for (const server of servers) {
        const cpuLeft = freeCpu.get(server.id)!;
        const memLeft = freeMem.get(server.id)!;

        // Hard feasibility constraint; policy logic cannot bypass this.
        if (cpuLeft < task.cpuRequired || memLeft < task.memRequired) {
          continue;
        }

        const features = this.placementFeatures(
          task,
          server,
          cpuLeft,
          memLeft,
          typicalCpu,
          typicalMem,
        );

        if (
          wFuture !== 0 ||
          this.policy.expressions?.placementScore !== undefined
        ) {
          features.futureCapacity = this.futureCapacity(
            task,
            server,
            servers,
            freeCpu,
            freeMem,
            sample,
          );
        }

        let score: number;

        if (this.policy.expressions?.placementScore) {
          score = evaluateExpression(
            this.policy.expressions.placementScore,
            features,
          );
        } else {
          score = 0;
          for (const [feature, weight] of Object.entries(this.weights)) {
            if (isOrdering(feature)) continue;
            score += (weight ?? 0) *
              (features[feature as PolicyFeature] ?? 0);
          }
        }

        if (!Number.isFinite(score)) {
          throw new Error(`Policy produced non-finite score: ${this.policy.policyName}`);
        }

        if (
          bestId === null ||
          score > bestScore + 1e-9 ||
          (preferHigh && Math.abs(score - bestScore) <= 1e-9)
        ) {
          bestScore = score;
          bestId = server.id;
        }
      }

      decisions.push({ taskId: task.id, serverId: bestId });

      if (bestId !== null) {
        freeCpu.set(bestId, freeCpu.get(bestId)! - task.cpuRequired);
        freeMem.set(bestId, freeMem.get(bestId)! - task.memRequired);
      }
    }

    return decisions;
  }

  private orderTasks(
    pending: ReadonlyArray<TaskView>,
    tick: number,
    maxWait: number,
    maxCpuCap: number,
    maxMemCap: number,
  ): TaskView[] {
    const expression = this.policy.expressions?.taskOrderingScore;

    if (!expression) {
      const wSize = this.weights.taskSize ?? 0;
      const wWait = this.weights.taskWaitTime ?? 0;
      const wPri = this.weights.priority ?? 0;

      if (wSize === 0 && wWait === 0 && wPri === 0) {
        return [...pending].sort(
          (a, b) => a.arrivalTime - b.arrivalTime,
        );
      }

      const maxDuration = Math.max(1, ...pending.map(t => t.duration));

      return [...pending].sort((a, b) => {
        const ka =
          wSize * ((a.cpuRequired / maxCpuCap + a.memRequired / maxMemCap) / 2) +
          wWait * ((tick - a.arrivalTime) / maxWait) +
          wPri * (a.priority / 3);

        const kb =
          wSize * ((b.cpuRequired / maxCpuCap + b.memRequired / maxMemCap) / 2) +
          wWait * ((tick - b.arrivalTime) / maxWait) +
          wPri * (b.priority / 3);

        return kb - ka || a.arrivalTime - b.arrivalTime;
      });
    }

    const taskFeatures = (task: TaskView): FeatureValues => ({
      taskSize:
        (task.cpuRequired / maxCpuCap + task.memRequired / maxMemCap) / 2,
      taskWaitTime: (tick - task.arrivalTime) / maxWait,
      priority: task.priority / 3,
    });

    return [...pending].sort((a, b) => {
      const ka = evaluateExpression(expression, taskFeatures(a));
      const kb = evaluateExpression(expression, taskFeatures(b));

      if (!Number.isFinite(ka) || !Number.isFinite(kb)) {
        throw new Error('Task-ordering expression produced a non-finite score');
      }

      return kb - ka || a.arrivalTime - b.arrivalTime;
    });
  }

  private placementFeatures(
    task: TaskView,
    server: ServerView,
    cpuLeft: number,
    memLeft: number,
    typicalCpu: number,
    typicalMem: number,
  ): FeatureValues {
    const cpuAfter = cpuLeft - task.cpuRequired;
    const memAfter = memLeft - task.memRequired;

    return {
      cpuFit: task.cpuRequired / Math.max(cpuLeft, 1e-12),
      memoryFit: task.memRequired / Math.max(memLeft, 1e-12),
      cpuFragmentation:
        cpuAfter > 0 && cpuAfter < typicalCpu
          ? cpuAfter / server.cpuCapacity
          : 0,
      memoryFragmentation:
        memAfter > 0 && memAfter < typicalMem
          ? memAfter / server.memCapacity
          : 0,
      resourceBalance:
        1 -
        Math.abs(
          cpuAfter / server.cpuCapacity -
          memAfter / server.memCapacity,
        ),
      serverLoad:
        (
          (server.cpuCapacity - cpuLeft) / server.cpuCapacity +
          (server.memCapacity - memLeft) / server.memCapacity
        ) / 2,
      normLeftover:
        cpuAfter / server.cpuCapacity +
        memAfter / server.memCapacity,
    };
  }

  private futureCapacity(
    task: TaskView,
    chosen: ServerView,
    servers: ReadonlyArray<ServerView>,
    freeCpu: Map<string, number>,
    freeMem: Map<string, number>,
    sample: Shape[],
  ): number {
    if (sample.length === 0) return 0;

    const cpu = servers.map(
      s => freeCpu.get(s.id)! -
        (s.id === chosen.id ? task.cpuRequired : 0),
    );
    const mem = servers.map(
      s => freeMem.get(s.id)! -
        (s.id === chosen.id ? task.memRequired : 0),
    );

    let placed = 0;

    for (const future of sample) {
      let bestIndex = -1;
      let bestLeft = Infinity;

      for (let i = 0; i < servers.length; i++) {
        if (cpu[i] < future.cpu || mem[i] < future.mem) continue;

        const leftover =
          (cpu[i] - future.cpu) / servers[i].cpuCapacity +
          (mem[i] - future.mem) / servers[i].memCapacity;

        if (leftover < bestLeft) {
          bestLeft = leftover;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) {
        cpu[bestIndex] -= future.cpu;
        mem[bestIndex] -= future.mem;
        placed++;
      }
    }

    return placed / sample.length;
  }
}
