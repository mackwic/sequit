import type { LogicDocument } from '../../../../lib/core/document/logic-document';
import {
	DocumentCommandDiagnosticCode,
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../../../../lib/infrastructure/document/document-command-contracts';
import { nodeFields, nodeUpdate } from '../../../../lib/infrastructure/document/node-fields';
import {
	type SharedDocumentCommand,
	SharedElementKind,
	type SharedTarget,
} from '../../../../lib/infrastructure/document/shared-document-command';
import type { CanvasDocumentCommandPort } from './canvas-edit-activity';

/** The slice of a document session the box dialog needs; every `DocumentSession` provides it. */
export interface NodeEditSession {
	read(): LogicDocument;
	updateText(target: SharedTarget, field: string, next: string): boolean;
	dispatch(commands: readonly SharedDocumentCommand[]): Promise<DocumentCommandOutcome>;
}

function nodeGone(nodeId: string): DocumentCommandOutcome {
	return {
		kind: DocumentCommandOutcomeKind.Rejected,
		diagnostics: [
			{
				code: DocumentCommandDiagnosticCode.NodeNotFound,
				message: `Node no longer exists: ${nodeId}`,
				path: ['nodes', nodeId],
			},
		],
	};
}

/**
 * Edits a node through any document session: content and description are spliced into their
 * texts, so a peer's concurrent edits survive; nature and style travel in one command, refused
 * as a whole.
 */
export function createNodeEditPort(session: NodeEditSession): CanvasDocumentCommandPort {
	return {
		readNode(nodeId) {
			const node = session.read().nodes.find(({ id }) => id === nodeId);
			if (node === undefined) return undefined;
			return nodeFields(node);
		},
		saveNode(nodeId, base, draft) {
			const target = { kind: SharedElementKind.Node, id: nodeId } as const;
			for (const field of ['markdown', 'description'] as const) {
				if (draft[field] === base[field]) continue;
				if (!session.updateText(target, field, draft[field]))
					return Promise.resolve(nodeGone(nodeId));
			}
			const command = nodeUpdate(nodeId, base, draft);
			if (command === undefined)
				return Promise.resolve({
					kind: DocumentCommandOutcomeKind.Accepted,
					document: session.read(),
				});
			return session.dispatch([command]);
		},
	};
}
