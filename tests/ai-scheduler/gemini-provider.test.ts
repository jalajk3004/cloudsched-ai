import { PolicyPromptContext } from '../../src/ai-scheduler/llm-provider';

const sampleContext: PolicyPromptContext = {
    scenario: 'mixed',
    serverCountSummary: '2 servers',
    sampleWorkloadSummary: '10 tasks',
    allowedFeatures: ['taskPriority', 'leftoverCpuAfterPlacement'],
    pastAttempts: [],
};

let mockGenerateContent: jest.Mock;
jest.mock('@google/genai', () => {
    return {
        GoogleGenAI: jest.fn().mockImplementation(() => ({
            models: { generateContent: (...args: any[]) => mockGenerateContent(...args) },
        })),
    };
});

describe('GeminiProvider (with a mocked SDK client)', () => {
    beforeEach(() => {
        mockGenerateContent = jest.fn();
    });

    it('correctly parses a valid JSON policy from the model response', async () => {
        mockGenerateContent.mockResolvedValue({
            text: JSON.stringify({
                policyName: 'gemini-test-policy',
                weights: { taskPriority: 0.6 },
                rejectIfNoServerFits: true,
                tieBreak: 'lowest_server_index',
            }),
        });

        const { GeminiProvider } = require('../../src/ai-scheduler/providers/gemini-provider');
        const provider = new GeminiProvider('fake-key-for-test');
        const result = await provider.proposePolicy(sampleContext);

        expect(result.policyName).toBe('gemini-test-policy');
        expect(result.weights.taskPriority).toBe(0.6);
    });

    it('throws a clear error when the model returns non-JSON text', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'Sure, here is a policy for you: ...' });

        const { GeminiProvider } = require('../../src/ai-scheduler/providers/gemini-provider');
        const provider = new GeminiProvider('fake-key-for-test');
        await expect(provider.proposePolicy(sampleContext)).rejects.toThrow(/did not return valid JSON/);
    });

    it('throws a clear error when the response has no text at all', async () => {
        mockGenerateContent.mockResolvedValue({ text: undefined });

        const { GeminiProvider } = require('../../src/ai-scheduler/providers/gemini-provider');
        const provider = new GeminiProvider('fake-key-for-test');
        await expect(provider.proposePolicy(sampleContext)).rejects.toThrow(/Empty response/);
    });

    it('requires an API key at construction time', () => {
        const original = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;
        try {
            const { GeminiProvider } = require('../../src/ai-scheduler/providers/gemini-provider');
            expect(() => new GeminiProvider()).toThrow(/No API key found/);
        } finally {
            if (original !== undefined) {
                process.env.GEMINI_API_KEY = original;
            }
        }
    });
});