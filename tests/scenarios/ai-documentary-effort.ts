import { readFile } from 'node:fs/promises';

const scenarioUrl = new URL('../../examples/ai-documentation.sequit.toml', import.meta.url);

export async function aiDocumentaryEffortScenario(): Promise<string> {
	return readFile(scenarioUrl, 'utf8');
}
