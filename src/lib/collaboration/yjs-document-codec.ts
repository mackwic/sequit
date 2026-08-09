import * as Y from 'yjs';

import type { LogicDocument } from '../document/logic-document';
import { createGraph } from '../graph/create-graph';
import {
	readStructuralLogicDocument,
	YjsLiveDocumentDiagnosticCode,
	type YjsLiveDocumentResult,
} from './yjs-document-reader';
import {
	createYjsEntityMap,
	YJS_LIVE_DOCUMENT_FORMAT,
	YjsCollection,
} from './yjs-document-schema';

export { YJS_LIVE_DOCUMENT_FORMAT };

export type { YjsLiveDocumentResult };

function replaceMapContents(
	target: Y.Map<unknown>,
	values: Readonly<Record<string, unknown>>,
): void {
	target.clear();
	for (const [key, value] of Object.entries(values)) target.set(key, value);
}

function replaceEntityCollection<T extends { readonly id: string }>(
	target: Y.Map<Y.Map<unknown>>,
	entities: readonly T[],
	project: (entity: T) => Readonly<Record<string, unknown>>,
): void {
	target.clear();
	for (const entity of entities) target.set(entity.id, createYjsEntityMap(project(entity)));
}

const IMPORT_ORIGIN = Symbol('sequit import');

export function importLogicDocument(
	ydoc: Y.Doc,
	document: LogicDocument,
	origin: unknown = IMPORT_ORIGIN,
): void {
	ydoc.transact(() => {
		replaceMapContents(ydoc.getMap(YjsCollection.Meta), {
			yjsLiveDocumentFormat: YJS_LIVE_DOCUMENT_FORMAT,
			persistenceFormat: document.persistenceFormat,
			id: document.id,
			title: document.title,
			layoutDirection: document.layout.direction,
			layoutBias: document.layout.bias,
		});
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Natures),
			document.natures,
			({ label, color }) => ({
				label,
				color,
			}),
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Groups),
			document.groups,
			({ label, groupId, layoutOrder }) => {
				const values: Record<string, unknown> = { label, layoutOrder };
				if (groupId !== undefined) values['groupId'] = groupId;
				return values;
			},
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Nodes),
			document.nodes,
			({ natureId, groupId, markdown, layoutOrder }) => {
				const text = new Y.Text();
				text.insert(0, markdown);
				const values: Record<string, unknown> = { natureId, layoutOrder, markdown: text };
				if (groupId !== undefined) values['groupId'] = groupId;
				return values;
			},
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Junctions),
			document.junctions,
			({ operator, groupId, layoutOrder }) => {
				const values: Record<string, unknown> = { operator, layoutOrder };
				if (groupId !== undefined) values['groupId'] = groupId;
				return values;
			},
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Relations),
			document.relations,
			({ from, to }) => ({
				from,
				to,
			}),
		);
	}, origin);
}

export function readLogicDocument(ydoc: Y.Doc): YjsLiveDocumentResult<LogicDocument> {
	const document = readStructuralLogicDocument(ydoc, YJS_LIVE_DOCUMENT_FORMAT);
	if (!document.ok) return document;
	const graph = createGraph(document.value);
	if (graph.ok) return { ok: true, value: graph.value.document };
	return {
		ok: false,
		diagnostics: graph.diagnostics.map(({ message, path }) => ({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message,
			path,
		})),
	};
}
