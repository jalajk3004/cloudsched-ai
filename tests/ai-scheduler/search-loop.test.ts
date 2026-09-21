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
      weights: { leftoverCpuAfterPlacement: -0.4, taskPriority: 0.5 },
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
  it('accepts a valid policy from the provider and returns it as the best policy', async () => {
    const result = await runSearchLoop(new AlwaysValidMockProvider(), 'mixed', servers, tasks, 30, 3);
    expect(result.bestPolicy).not.toBeNull();
    expect(result.bestPolicy!.policyName).toBe('mock-policy');
    expect(result.log.length).toBe(3);
    // every attempt should be schema-valid and pass the dry run...
    expect(result.log.every(entry => entry.schemaValid && entry.dryRunOk)).toBe(true);
    // ...but only the FIRST identical proposal counts as "accepted" (a
    // strictly better score than the best-so-far) - repeating the same
    // policy again isn't an improvement, which is correct behavior.
    expect(result.log.filter(entry => entry.accepted).length).toBe(1);
  });

  it('rejects an invalid policy at the schema stage and keeps no best policy', async () => {
    const result = await runSearchLoop(new AlwaysInvalidMockProvider(), 'mixed', servers, tasks, 30, 2);
    expect(result.bestPolicy).toBeNull();
    expect(result.log.every(entry => !entry.schemaValid)).toBe(true);
  });

  it('handles a provider that throws without crashing the whole loop', async () => {
    const result = await runSearchLoop(new ThrowingMockProvider(), 'mixed', servers, tasks, 30, 2);
    expect(result.bestPolicy).toBeNull();
    expect(result.log.length).toBe(2);
    expect(result.log[0].schemaRejectReason).toMatch(/Provider threw/);
  });

  it('the Groq provider throws a clear error when no API key is configured', async () => {
    const { GroqProvider } = require('../../src/ai-scheduler/providers/groq-provider');
    expect(() => new GroqProvider()).toThrow(/No API key found/);
  });

  it('the still-stubbed Gemini provider throws a clear not-implemented error', async () => {
    const { GeminiProvider } = require('../../src/ai-scheduler/providers/gemini-provider');
    const provider = new GeminiProvider();
    await expect(provider.proposePolicy({} as PolicyPromptContext)).rejects.toThrow(/Not implemented yet/);
  });

  // QwenProvider's own tests (against a mock local Ollama server) live in
  // tests/ai-scheduler/qwen-provider.test.ts, since it needs no API key
  // and behaves differently enough (HTTP to a local server, not a
  // hosted API) to warrant its own dedicated test file.
});