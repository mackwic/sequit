import { describe, it } from 'vitest';

import { CollaborationAuthority } from '../../../support/harnesses/collaboration-authority';
import { collaborationContractScenarios } from '../../../support/scenarios/collaboration';

describe('in-memory collaboration protocol contract', () => {
	for (const [index, scenario] of collaborationContractScenarios.entries()) {
		it(scenario.name, async () => {
			const authority = new CollaborationAuthority(`memory-contract-${index}`);
			await scenario.run({
				roomId: authority.roomId,
				connect: () => Promise.resolve(authority.scenarioClient()),
			});
		});
	}
});
