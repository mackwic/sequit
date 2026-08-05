import type * as Y from 'yjs';

import type { DocumentCommandOutcome } from '../document/document-command-gateway';
import type { LogicDocument, LogicRelation, NewLogicNode } from '../document/logic-document';
import { projectNodeAddition, projectRelationAddition } from '../document/topology-edits';
import { fractionalOrderKeySpace } from '../layout/order-key-space';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';
import { YjsDocumentRepository } from './yjs-document-repository';

export * from './yjs-document-codec';
export { replaceNodeMarkdown } from './yjs-document-repository';

const ADD_NODE_ORIGIN = Symbol('sequit add node');
const ADD_RELATION_ORIGIN = Symbol('sequit add relation');

function legacyResult(outcome: DocumentCommandOutcome): YjsLiveDocumentResult<LogicDocument> {
	if (outcome.kind === 'accepted') return { ok: true, value: outcome.document };
	if (outcome.kind === 'failed') throw outcome.error;
	return { ok: false, diagnostics: outcome.diagnostics };
}

function runLegacyCommand(
	document: Y.Doc,
	origin: unknown,
	project: (current: LogicDocument) => ReturnType<typeof projectNodeAddition>,
): YjsLiveDocumentResult<LogicDocument> {
	const current = readLogicDocument(document);
	if (!current.ok) return current;
	const repository = new YjsDocumentRepository(document);
	try {
		let projected: ReturnType<typeof projectNodeAddition>;
		try {
			projected = project(current.value);
		} catch (error) {
			return legacyResult({ kind: 'failed', error });
		}
		if (!projected.ok) return { ok: false, diagnostics: projected.diagnostics };
		const materialized = repository.persistSync(projected.value.changes, origin);
		return materialized.ok ? { ok: true, value: materialized.value } : materialized;
	} finally {
		repository.destroy();
	}
}

export function addNodeToLiveDocument(
	document: Y.Doc,
	node: NewLogicNode,
	origin: unknown = ADD_NODE_ORIGIN,
): YjsLiveDocumentResult<LogicDocument> {
	return runLegacyCommand(document, origin, (current) =>
		projectNodeAddition(current, node, fractionalOrderKeySpace),
	);
}

export function addRelationToLiveDocument(
	document: Y.Doc,
	relation: LogicRelation,
	origin: unknown = ADD_RELATION_ORIGIN,
): YjsLiveDocumentResult<LogicDocument> {
	return runLegacyCommand(document, origin, (current) =>
		projectRelationAddition(current, relation, fractionalOrderKeySpace),
	);
}
