import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { GraphDiagnosticCode } from '../../../../src/lib/core/graph/create-graph';
import {
	AuthorizationDiagnosticCode,
	authorizeProposal,
} from '../../../../src/lib/infrastructure/collaboration/authorize-proposal';
import { defaultUpdateGuards } from '../../../../src/lib/infrastructure/collaboration/update-guards';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { replaceNodeMarkdown } from '../../../../src/lib/infrastructure/collaboration/yjs-document-repository';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { proposeChange } from '../../../support/builders/collaboration';
import { validLogicDocument } from '../../../support/builders/logic-document';

function authoritativeDocument(): Y.Doc {
	const authoritative = new Y.Doc();
	importLogicDocument(authoritative, validLogicDocument());
	return authoritative;
}

function readAuthoritative(authoritative: Y.Doc) {
	const document = readLogicDocument(authoritative);
	if (!document.ok) throw new Error('Expected a valid authoritative document');
	return document.value;
}

describe('authorizeProposal', () => {
	it('a valid Markdown edit is accepted and reflected in the candidate document', async () => {
		const authoritative = authoritativeDocument();
		const proposedUpdate = proposeChange(authoritative, (candidate) => {
			replaceNodeMarkdown(candidate, 'source-a', 'Authorized edit');
		});

		const result = await authorizeProposal({
			proposalId: 'markdown-edit',
			authoritative,
			acceptedDocument: readAuthoritative(authoritative),
			proposedUpdate,
			guards: defaultUpdateGuards,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.candidateDocument.nodes).toContainEqual(
				expect.objectContaining({ id: 'source-a', markdown: 'Authorized edit' }),
			);
			expect(result.value.candidateGraph.document).toBe(result.value.candidateDocument);
			result.value.candidate.destroy();
		}
		authoritative.destroy();
	});

	it('the candidate is independent of the authoritative document', async () => {
		const authoritative = authoritativeDocument();
		const proposedUpdate = proposeChange(authoritative, () => undefined);
		const result = await authorizeProposal({
			proposalId: 'independence',
			authoritative,
			acceptedDocument: readAuthoritative(authoritative),
			proposedUpdate,
			guards: defaultUpdateGuards,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.candidate).not.toBe(authoritative);
			replaceNodeMarkdown(result.value.candidate, 'source-a', 'Candidate only');
			expect(readAuthoritative(authoritative).nodes).toContainEqual(
				expect.objectContaining({ id: 'source-a', markdown: 'Source A\n' }),
			);
			result.value.candidate.destroy();
		}
		authoritative.destroy();
	});

	it('a relation closing a cycle is rejected with the graph cycle code', async () => {
		const authoritative = authoritativeDocument();
		const proposedUpdate = proposeChange(authoritative, (candidate) => {
			candidate
				.getMap<Y.Map<unknown>>(YjsCollection.Relations)
				.set('target-to-source', createYjsEntityMap({ from: 'target', to: 'source-a' }));
		});

		const result = await authorizeProposal({
			proposalId: 'cycle',
			authoritative,
			acceptedDocument: readAuthoritative(authoritative),
			proposedUpdate,
			guards: defaultUpdateGuards,
		});

		expect(result).toMatchObject({
			ok: false,
			diagnostics: [{ code: GraphDiagnosticCode.Cycle, path: ['relations'] }],
		});
		authoritative.destroy();
	});

	it('malformed live state is rejected with the live-document code', async () => {
		const authoritative = authoritativeDocument();
		const proposedUpdate = proposeChange(authoritative, (candidate) => {
			candidate
				.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
				.get('source-a')
				?.set('markdown', 'not collaborative text');
		});

		const result = await authorizeProposal({
			proposalId: 'malformed-live-state',
			authoritative,
			acceptedDocument: readAuthoritative(authoritative),
			proposedUpdate,
			guards: defaultUpdateGuards,
		});

		expect(result).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'invalid-yjs-live-document', path: ['nodes', 'source-a', 'markdown'] }],
		});
		authoritative.destroy();
	});

	it('an undecodable update is rejected as malformed', async () => {
		const authoritative = authoritativeDocument();

		const result = await authorizeProposal({
			proposalId: 'malformed-update',
			authoritative,
			acceptedDocument: readAuthoritative(authoritative),
			proposedUpdate: new Uint8Array([255]),
			guards: defaultUpdateGuards,
		});

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: AuthorizationDiagnosticCode.MalformedYjsUpdate,
					message: 'Proposed update is not a decodable Yjs update',
					path: ['proposal', 'update'],
				},
			],
		});
		authoritative.destroy();
	});

	it('initialization authorizes against itself and passes the identity guard', async () => {
		const authoritative = new Y.Doc();
		const initial = authoritativeDocument();
		const expected = readAuthoritative(initial);

		const result = await authorizeProposal({
			proposalId: 'initialize',
			authoritative,
			acceptedDocument: undefined,
			proposedUpdate: Y.encodeStateAsUpdate(initial),
			guards: defaultUpdateGuards,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.candidateDocument).toEqual(expected);
			result.value.candidate.destroy();
		}
		initial.destroy();
		authoritative.destroy();
	});

	it('an id-changing update is rejected by the identity guard', async () => {
		const authoritative = authoritativeDocument();
		const proposedUpdate = proposeChange(authoritative, (candidate) => {
			candidate.getMap(YjsCollection.Meta).set('id', 'changed-document');
		});

		const result = await authorizeProposal({
			proposalId: 'identity-change',
			authoritative,
			acceptedDocument: readAuthoritative(authoritative),
			proposedUpdate,
			guards: defaultUpdateGuards,
		});

		expect(result).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'document-identity-changed', path: ['document', 'id'] }],
		});
		authoritative.destroy();
	});

	it('destroys its candidate and propagates an unexpected guard failure', async () => {
		const authoritative = authoritativeDocument();
		const proposedUpdate = proposeChange(authoritative, () => undefined);

		await expect(
			authorizeProposal({
				proposalId: 'throwing-guard',
				authoritative,
				acceptedDocument: readAuthoritative(authoritative),
				proposedUpdate,
				guards: [
					{
						name: 'throwing',
						evaluate(): never {
							throw new Error('Unexpected guard failure');
						},
					},
				],
			}),
		).rejects.toThrow('Unexpected guard failure');
		authoritative.destroy();
	});
});
