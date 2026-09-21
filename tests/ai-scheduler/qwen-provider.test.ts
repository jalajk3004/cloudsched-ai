import * as http from 'http';
import { QwenProvider } from '../../src/ai-scheduler/providers/qwen-provider';
import { PolicyPromptContext } from '../../src/ai-scheduler/llm-provider';

const sampleContext: PolicyPromptContext = {
    scenario: 'mixed',
    serverCountSummary: '2 servers',
    sampleWorkloadSummary: '10 tasks',
    allowedFeatures: ['taskPriority', 'leftoverCpuAfterPlacement'],
    pastAttempts: [],
};

/** Spins up a tiny local HTTP server that mimics Ollama's /api/chat
 *  response shape, so we can test QwenProvider's parsing and error
 *  handling without needing a real Ollama installation. */
function startMockOllama(responder: (body: any) => { status: number; json: any }): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            let raw = '';
            req.on('data', chunk => (raw += chunk));
            req.on('end', () => {
                const body = raw ? JSON.parse(raw) : {};
                const { status, json } = responder(body);
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(json));
            });
        });
        server.listen(0, () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({
                url: `http://localhost:${port}`,
                close: () => new Promise<void>(res => server.close(() => res())),
            });
        });
    });
}

describe('QwenProvider (against a mock local Ollama server)', () => {
    it('correctly parses a valid JSON policy from the mock server', async () => {
        const mock = await startMockOllama(() => ({
            status: 200,
            json: {
                message: {
                    content: JSON.stringify({
                        policyName: 'qwen-test-policy',
                        weights: { taskPriority: 0.5 },
                        rejectIfNoServerFits: true,
                        tieBreak: 'lowest_server_index',
                    })
                }
            },
        }));

        const provider = new QwenProvider(mock.url, 'qwen3:4b');
        const result = await provider.proposePolicy(sampleContext);

        expect(result.policyName).toBe('qwen-test-policy');
        expect(result.weights.taskPriority).toBe(0.5);
        await mock.close();
    });

    it('throws a clear error when the model returns non-JSON text', async () => {
        const mock = await startMockOllama(() => ({
            status: 200,
            json: { message: { content: 'Sure! Here is a policy for you: ...' } },
        }));

        const provider = new QwenProvider(mock.url, 'qwen3:4b');
        await expect(provider.proposePolicy(sampleContext)).rejects.toThrow(/did not return valid JSON/);
        await mock.close();
    });

    it('throws a clear error on a non-200 response from Ollama', async () => {
        const mock = await startMockOllama(() => ({ status: 500, json: { error: 'model not found' } }));

        const provider = new QwenProvider(mock.url, 'qwen3:4b');
        await expect(provider.proposePolicy(sampleContext)).rejects.toThrow(/Ollama returned HTTP 500/);
        await mock.close();
    });

    it('throws a clear "is Ollama running?" error when the server is unreachable', async () => {
        // deliberately point at a port nothing is listening on
        const provider = new QwenProvider('http://localhost:1', 'qwen3:4b');
        await expect(provider.proposePolicy(sampleContext)).rejects.toThrow(/Is Ollama running/);
    });
});