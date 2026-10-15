import { runSearchLoop } from '../../src/ai-scheduler/search-loop';
import { LLMProvider, PolicyPromptContext, PolicyProposal } from '../../src/ai-scheduler/llm-provider';
import { Task } from '../../src/domain/types';
import { ServerConfig } from '../../src/engine/simulation-engine';

const servers: ServerConfig[] = [{ id: 's1', cpuCapacity: 8, memCapacity: 8192 }, { id: 's2', cpuCapacity: 8, memCapacity: 8192 }];
const tasks: Task[] = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i}`, cpuRequired: 1 + (i % 4), memRequired: 500 + i * 100, duration: 3, arrivalTime: i, priority: 2, status: 'pending' as const,
}));

/** A fake provider used only for testing - proposes a fixed, valid policy every time. */
class AlwaysValidMockProvider implements LLMProvider {
  readonly name = 'mock-valid';
  async proposePolicy(_context: PolicyPromptContext): Promise<PolicyProposal> {
    return {
      policyName: 'mock-policy',
      weights: { cpuFit: 0.4, priority: 0.5 },
      rejectIfNoServerFits: true,
      tieBreak: 'lowest_server_index',
    };
  }
}

/** A fake provider that returns garbage the schema validator must catch. */
class AlwaysInvalidMockProvider implements LLMProvider {
  readonly name = 'mock-invalid';
  async proposePolicy(_context: PolicyPromptContext): Promise<PolicyProposal> {
    return { thisIsNotAPolicy: true } as any;
  }
}

/** A fake provider that throws, simulating a real API failure. */
class ThrowingMockProvider implements LLMProvider {
  readonly name = 'mock-throwing';
  async proposePolicy(_context: PolicyPromptContext): Promise<PolicyProposal> {
    throw new Error('simulated network failure');
  }
}

describe('runSearchLoop (using a mock provider - no real LLM needed)', () => {
  it('accepts a valid policy from the provider and logs LLM attempts', async () => {
    const result = await runSearchLoop(new AlwaysValidMockProvider(), 'mixed', servers, tasks, 30, 3);
    expect(result.bestPolicy).not.toBeNull();
    const llmEntries = result.log.filter(entry => entry.source === 'llm');
    expect(llmEntries.length).toBe(3);
    expect(llmEntries[0].schemaValid).toBe(true);
    expect(llmEntries[0].dryRunOk).toBe(true);
    // Subsequent identical proposals are rejected by distance check as too similar
    expect(llmEntries[1].schemaRejectReason).toMatch(/too similar/);
  });

  it('rejects an invalid policy at the schema stage and attributes winner to the library', async () => {
    const result = await runSearchLoop(new AlwaysInvalidMockProvider(), 'mixed', servers, tasks, 30, 2);
    const llmEntries = result.log.filter(entry => entry.source === 'llm');
    expect(llmEntries.length).toBe(2);
    expect(llmEntries.every(entry => !entry.schemaValid)).toBe(true);
    expect(result.bestSource).toBe('library');
    expect(result.bestPolicy).not.toBeNull();
  });

  it('handles a provider that throws without crashing the whole loop', async () => {
    const result = await runSearchLoop(new ThrowingMockProvider(), 'mixed', servers, tasks, 30, 2);
    const llmEntries = result.log.filter(entry => entry.source === 'llm');
    expect(llmEntries.length).toBe(2);
    expect(llmEntries[0].schemaRejectReason).toMatch(/Provider threw/);
    expect(result.bestSource).toBe('library');
    expect(result.bestPolicy).not.toBeNull();
  });
});