import seedrandom from 'seedrandom';
import { validatePolicySchema } from '../src/ai-scheduler/policy-validator';
import { PolicyInterpreterScheduler } from '../src/ai-scheduler/policy-interpreter';
import { runSearchLoop, isAdmissible } from '../src/ai-scheduler/search-loop';
import { STRATEGY_LIBRARY } from '../src/ai-scheduler/strategy-library';
import { ALLOWED_POLICY_FEATURES, LLMProvider, PolicyProposal } from '../src/ai-scheduler/llm-provider';
import { BestFitScheduler } from '../src/schedulers/best-fit';
import { generateWorkload } from '../src/workload/generator';
import { computeObjectiveScore, Metrics } from '../src/metrics/metrics-engine';
import { DEFAULT_SERVERS } from '../src/experiment/server-configs';
import { Priority, ServerView, TaskView } from '../src/domain/types';

const base = (o: Record<string, unknown> = {}) => ({
    policyName: 'p', weights: { cpuFit: 1 }, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index', ...o,
});

describe('policy validator', () => {
    it('accepts valid policies, including boundary weights and baseStrategy with empty weights', () => {
        expect(validatePolicySchema(base()).valid).toBe(true);
        expect(validatePolicySchema(base({ weights: { cpuFit: 1, memoryFit: -1 } })).valid).toBe(true);
        expect(validatePolicySchema(base({ baseStrategy: 'tight_packing', weights: {} })).valid).toBe(true);
    });

    it.each([
        ['NaN weight', { weights: { cpuFit: NaN } }],
        ['Infinity weight', { weights: { cpuFit: Infinity } }],
        ['too large', { weights: { cpuFit: 1.01 } }],
        ['too small', { weights: { cpuFit: -1.01 } }],
        ['string weight', { weights: { cpuFit: '0.5' } }],
        ['unknown feature', { weights: { magic: 0.5 } }],
        ['oracle feature not offered to the model', { weights: { taskDuration: -1 } }],
        ['array weights', { weights: [0.5] }],
        ['array weights with baseStrategy', { baseStrategy: 'tight_packing', weights: [] }],
        ['empty weights without baseStrategy', { weights: {} }],
        ['unknown baseStrategy', { baseStrategy: 'nope' }],
        ['prototype-key baseStrategy', { baseStrategy: 'toString' }],
        ['bad tieBreak', { tieBreak: 'random' }],
        ['missing reject flag', { rejectIfNoServerFits: undefined }],
        ['empty name', { policyName: '  ' }],
    ])('rejects: %s', (_label, override) => {
        expect(validatePolicySchema(base(override as Record<string, unknown>)).valid).toBe(false);
    });

    it('rejects non-objects', () => {
        for (const bad of [null, undefined, 5, 'x', []]) expect(validatePolicySchema(bad).valid).toBe(false);
    });
});

function randomState(rng: seedrandom.PRNG) {
    const servers: ServerView[] = Array.from({ length: 1 + Math.floor(rng() * 4) }, (_, i) => {
        const cpuCapacity = 8 * (1 + Math.floor(rng() * 2));
        const memCapacity = cpuCapacity * 2048;
        return {
            id: `s${i + 1}`, cpuCapacity, memCapacity,
            cpuUsed: Math.floor(rng() * cpuCapacity * 0.8), memUsed: Math.floor(rng() * memCapacity * 0.8), runningTaskIds: [],
        };
    });
    const tasks: TaskView[] = Array.from({ length: 1 + Math.floor(rng() * 12) }, (_, i) => ({
        id: `t${i}`, cpuRequired: 1 + Math.floor(rng() * 8), memRequired: 512 + Math.floor(rng() * 7680),
        duration: 2 + Math.floor(rng() * 18), arrivalTime: Math.floor(rng() * 5),
        priority: (1 + Math.floor(rng() * 3)) as Priority, status: 'pending' as const,
    }));
    return { servers, tasks };
}

describe('policy interpreter', () => {
    it('never over-books, never double-assigns, and decides every pending task', () => {
        const rng = seedrandom('interp-property');
        for (let n = 0; n < 300; n++) {
            const { servers, tasks } = randomState(rng);
            const weights: Record<string, number> = {};
            for (const f of ALLOWED_POLICY_FEATURES) if (rng() < 0.5) weights[f] = rng() * 2 - 1;
            if (Object.keys(weights).length === 0) weights.cpuFit = 1;
            const policy = { policyName: 'rnd', weights, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index' } as PolicyProposal;

            const decisions = new PolicyInterpreterScheduler(policy).schedule(tasks, servers, 5);
            expect(decisions.length).toBe(tasks.length);
            expect(new Set(decisions.map(d => d.taskId)).size).toBe(tasks.length);

            const cpu = new Map(servers.map(s => [s.id, s.cpuCapacity - s.cpuUsed]));
            const mem = new Map(servers.map(s => [s.id, s.memCapacity - s.memUsed]));
            for (const d of decisions) {
                if (d.serverId === null) continue;
                const task = tasks.find(x => x.id === d.taskId)!;
                cpu.set(d.serverId, cpu.get(d.serverId)! - task.cpuRequired);
                mem.set(d.serverId, mem.get(d.serverId)! - task.memRequired);
                expect(cpu.get(d.serverId)!).toBeGreaterThanOrEqual(0);
                expect(mem.get(d.serverId)!).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('is deterministic, and baseStrategy equals the same weights spelled out', () => {
        const rng = seedrandom('interp-determinism');
        const viaBase = { policyName: 'a', baseStrategy: 'tight_packing', weights: {}, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index' } as PolicyProposal;
        const explicit = { policyName: 'b', weights: { cpuFit: 1, memoryFit: 1 }, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index' } as PolicyProposal;
        for (let n = 0; n < 100; n++) {
            const { servers, tasks } = randomState(rng);
            const a1 = new PolicyInterpreterScheduler(viaBase).schedule(tasks, servers, 3);
            const a2 = new PolicyInterpreterScheduler(viaBase).schedule(tasks, servers, 3);
            const b = new PolicyInterpreterScheduler(explicit).schedule(tasks, servers, 3);
            expect(a1).toEqual(a2);
            expect(a1).toEqual(b);
        }
    });

    it('best_fit_exact reproduces the Best-Fit baseline decision for decision', () => {
        const rng = seedrandom('interp-bestfit');
        const exact = { policyName: 'bfx', baseStrategy: 'best_fit_exact', weights: {}, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index' } as PolicyProposal;
        for (let n = 0; n < 300; n++) {
            const { servers, tasks } = randomState(rng);
            const ai = new Map(new PolicyInterpreterScheduler(exact).schedule(tasks, servers, 3).map(d => [d.taskId, d.serverId]));
            const bf = new Map(new BestFitScheduler().schedule(tasks, servers, 3).map(d => [d.taskId, d.serverId]));
            expect(ai).toEqual(bf);
        }
    });
});

class Scripted implements LLMProvider {
    readonly name = 'scripted';
    private i = 0;
    constructor(private proposals: unknown[]) { }
    async proposePolicy(): Promise<PolicyProposal> { return this.proposals[this.i++ % this.proposals.length] as PolicyProposal; }
}

const wl = (seed: string) => generateWorkload({
    scenario: 'mixed', seed, taskCount: 40, cpuRange: [1, 8], memRange: [512, 8192], durationRange: [2, 20], simulationDuration: 40,
});
const runScripted = (proposals: unknown[]) =>
    runSearchLoop(new Scripted(proposals), 'mixed', DEFAULT_SERVERS, wl('s1'), 40, proposals.length, [wl('s2')], [wl('v1')]);

const scripted = [
    { policyName: 'p1', baseStrategy: 'tight_packing', weights: { resourceBalance: 0.9 }, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index' },
    { policyName: 'p2', baseStrategy: 'future_preserving', weights: { serverLoad: -0.8 }, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index' },
];

describe('search loop', () => {
    it('is reproducible: same inputs give an identical log and winner', async () => {
        const a = await runScripted(scripted);
        const b = await runScripted(scripted);
        expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
        expect(a.bestPolicy).toEqual(b.bestPolicy);
        expect(a.bestScore).toBe(b.bestScore);
    });

    it('scores every logged candidate with the one fixed objective', async () => {
        const r = await runScripted(scripted);
        for (const e of r.log) if (e.metrics) expect(e.overallScore).toBeCloseTo(computeObjectiveScore(e.metrics), 12);
    });

    it('evaluates the whole strategy library with no LLM and always returns a winner', async () => {
        const r = await runScripted([{ junk: true }]);
        expect(r.log.filter(e => e.source === 'library').length).toBe(Object.keys(STRATEGY_LIBRARY).length);
        expect(r.log.filter(e => e.source === 'llm').every(e => !e.schemaValid)).toBe(true);
        expect(r.bestPolicy).not.toBeNull();
        expect(r.bestSource).toBe('library');
    });

    it('rejects a proposal that duplicates an existing strategy', async () => {
        const r = await runScripted([{ policyName: 'dup', baseStrategy: 'tight_packing', weights: {}, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index' }]);
        const llm = r.log.filter(e => e.source === 'llm');
        expect(llm[0].schemaRejectReason).toMatch(/too similar/);
    });

    it('applies the p95 guardrail exactly: allowed up to 1.5x best-fit + 1 tick', () => {
        const m = (p95: number) => ({ p95WaitingTime: p95 } as Metrics);
        expect(isAdmissible(m(18), m(18))).toBe(true);
        expect(isAdmissible(m(28), m(18))).toBe(true);
        expect(isAdmissible(m(28.1), m(18))).toBe(false);
    });
});