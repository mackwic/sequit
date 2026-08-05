import type * as Y from 'yjs';

import {
	type DocumentCommandOutcome,
	LocalDocumentCommandGateway,
} from '../document/document-command-gateway';
import type { LogicDocument, LogicRelation, NewLogicNode } from '../document/logic-document';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';
import { YjsDocumentRepository } from './yjs-document-repository';

export * from './yjs-document-codec';
export { replaceNodeMarkdown } from './yjs-document-repository';

const ADD_NODE_ORIGIN = Symbol('sequit add node');
const ADD_RELATION_ORIGIN = Symbol('sequit add relation');

function legacyResult(outcome: DocumentCommandOutcome): YjsLiveDocumentResult<LogicDocument> {
	if (outcome.kind === 'accepted') return { ok: true, value: outcome.document };
	if (outcome.kind === 'failed') throw outcome.error;
	return {
		ok: false,
		diagnostics: outcome.diagnostics.map(({ message, path }) => ({
			code: 'invalid-yjs-live-document',
			message,
			path,
		})),
	};
}

function runLegacyCommand(
	document: Y.Doc,
	origin: unknown,
	command: (gateway: LocalDocumentCommandGateway) => DocumentCommandOutcome,
): YjsLiveDocumentResult<LogicDocument> {
	return document.transact(() => {
		const current = readLogicDocument(document);
		if (!current.ok) return current;
		const repository = new YjsDocumentRepository(document);
		try {
			const gateway = new LocalDocumentCommandGateway(() => current.value, repository, origin);
			return legacyResult(command(gateway));
		} finally {
			repository.destroy();
		}
	}, origin);
}

export function addNodeToLiveDocument(
	document: Y.Doc,
	node: NewLogicNode,
	origin: unknown = ADD_NODE_ORIGIN,
): YjsLiveDocumentResult<LogicDocument> {
	return runLegacyCommand(document, origin, (gateway) => gateway.addNode(node));
}

export function addRelationToLiveDocument(
	document: Y.Doc,
	relation: LogicRelation,
	origin: unknown = ADD_RELATION_ORIGIN,
): YjsLiveDocumentResult<LogicDocument> {
	return runLegacyCommand(document, origin, (gateway) => gateway.addRelation(relation));
}
