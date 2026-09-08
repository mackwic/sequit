import * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import { createGraph, type LogicGraph } from '../../core/graph/create-graph';
import type { ProtocolDiagnostic } from './protocol';
import { runUpdateGuards, type UpdateGuard } from './update-guards';
import { readStructuralLogicDocument } from './yjs-document-reader';
import { YJS_LIVE_DOCUMENT_FORMAT } from './yjs-document-schema';

export enum AuthorizationDiagnosticCode {
	MalformedYjsUpdate = 'malformed-yjs-update',
}

export interface AuthorizationInput {
	readonly proposalId: string;
	readonly authoritative: Y.Doc;
	readonly acceptedDocument: LogicDocument | undefined;
	readonly proposedUpdate: Uint8Array;
	readonly guards: readonly UpdateGuard[];
}

interface AuthorizedProposal {
	readonly candidate: Y.Doc;
	readonly candidateDocument: LogicDocument;
	readonly candidateGraph: LogicGraph;
}

interface AuthorizationSuccess {
	readonly ok: true;
	readonly value: AuthorizedProposal;
}

interface AuthorizationFailure {
	readonly ok: false;
	readonly diagnostics: readonly ProtocolDiagnostic[];
}

export type AuthorizationResult = AuthorizationSuccess | AuthorizationFailure;

function malformedUpdateFailure(): AuthorizationFailure {
	return {
		ok: false,
		diagnostics: [
			{
				code: AuthorizationDiagnosticCode.MalformedYjsUpdate,
				message: 'Proposed update is not a decodable Yjs update',
				path: ['proposal', 'update'],
			},
		],
	};
}

export async function authorizeProposal(input: AuthorizationInput): Promise<AuthorizationResult> {
	const candidate = new Y.Doc();
	try {
		try {
			Y.applyUpdate(candidate, Y.encodeStateAsUpdate(input.authoritative));
			Y.applyUpdate(candidate, input.proposedUpdate);
		} catch {
			candidate.destroy();
			return malformedUpdateFailure();
		}

		const document = readStructuralLogicDocument(candidate, YJS_LIVE_DOCUMENT_FORMAT);
		if (!document.ok) {
			candidate.destroy();
			return { ok: false, diagnostics: document.diagnostics };
		}

		const graph = createGraph(document.value);
		if (!graph.ok) {
			candidate.destroy();
			return { ok: false, diagnostics: graph.diagnostics };
		}

		const guardResult = await runUpdateGuards(input.guards, {
			proposalId: input.proposalId,
			acceptedDocument: input.acceptedDocument ?? document.value,
			candidateDocument: document.value,
			candidateGraph: graph.value,
		});
		if (!guardResult.ok) {
			candidate.destroy();
			return { ok: false, diagnostics: guardResult.diagnostics };
		}

		return {
			ok: true,
			value: { candidate, candidateDocument: document.value, candidateGraph: graph.value },
		};
	} catch (error) {
		candidate.destroy();
		throw error;
	}
}
