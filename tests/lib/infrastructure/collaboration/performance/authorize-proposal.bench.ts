import { bench, describe } from 'vitest';
import * as Y from 'yjs';

import { authorizeProposal } from '../../../../../src/lib/infrastructure/collaboration/authorize-proposal';
import { defaultUpdateGuards } from '../../../../../src/lib/infrastructure/collaboration/update-guards';
import { importLogicDocument } from '../../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { replaceNodeMarkdown } from '../../../../../src/lib/infrastructure/collaboration/yjs-document-repository';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { proposeChange } from '../../../../support/builders/collaboration';
import { validLogicDocument } from '../../../../support/builders/logic-document';
import { LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS } from '../../../../support/performance/layout-performance-policy';

const document = validLogicDocument();
const authoritative = new Y.Doc();
importLogicDocument(authoritative, document);

const markdownUpdate = proposeChange(authoritative, (candidate) => {
	replaceNodeMarkdown(candidate, 'source-a', 'Benchmark edit');
});
const relationUpdate = proposeChange(authoritative, (candidate) => {
	candidate
		.getMap<Y.Map<unknown>>(YjsCollection.Relations)
		.set('isolated-to-target', createYjsEntityMap({ from: 'isolated', to: 'target' }));
});

async function authorize(update: Uint8Array): Promise<void> {
	const result = await authorizeProposal({
		proposalId: 'benchmark',
		authoritative,
		acceptedDocument: document,
		proposedUpdate: update,
		guards: defaultUpdateGuards,
	});
	if (!result.ok) throw new Error('Benchmark proposal must be authorized');
	result.value.candidate.destroy();
}

describe('authorizeProposal', () => {
	bench(
		'single-node Markdown edit',
		async () => authorize(markdownUpdate),
		LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS,
	);
	bench(
		'relation addition',
		async () => authorize(relationUpdate),
		LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS,
	);
});
