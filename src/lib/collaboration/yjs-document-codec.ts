import * as Y from 'yjs';

import type { LogicDocument } from '../document/logic-document';
import {
	readYjsLogicDocument,
	type YjsLiveDocumentDiagnostic,
	type YjsLiveDocumentResult,
} from './yjs-document-reader';
import { createYjsEntityMap, YJS_COLLECTIONS } from './yjs-document-schema';

export const YJS_LIVE_DOCUMENT_FORMAT = 3 as const;

export type { YjsLiveDocumentDiagnostic, YjsLiveDocumentResult };

const {
	meta: META,
	natures: NATURES,
	groups: GROUPS,
	nodes: NODES,
	junctions: JUNCTIONS,
	relations: RELATIONS,
} = YJS_COLLECTIONS;

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
		replaceMapContents(ydoc.getMap(META), {
			yjsLiveDocumentFormat: YJS_LIVE_DOCUMENT_FORMAT,
			persistenceFormat: document.persistenceFormat,
			id: document.id,
			title: document.title,
			layoutDirection: document.layout.direction,
			layoutBias: document.layout.bias,
		});
		replaceEntityCollection(ydoc.getMap(NATURES), document.natures, ({ label, color }) => ({
			label,
			color,
		}));
		replaceEntityCollection(
			ydoc.getMap(GROUPS),
			document.groups,
			({ label, groupId, layoutOrder }) => {
				const values: Record<string, unknown> = { label, layoutOrder };
				if (groupId !== undefined) values['groupId'] = groupId;
				return values;
			},
		);
		replaceEntityCollection(
			ydoc.getMap(NODES),
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
			ydoc.getMap(JUNCTIONS),
			document.junctions,
			({ operator, groupId, layoutOrder }) => {
				const values: Record<string, unknown> = { operator, layoutOrder };
				if (groupId !== undefined) values['groupId'] = groupId;
				return values;
			},
		);
		replaceEntityCollection(ydoc.getMap(RELATIONS), document.relations, ({ from, to }) => ({
			from,
			to,
		}));
	}, origin);
}

export function readLogicDocument(ydoc: Y.Doc): YjsLiveDocumentResult<LogicDocument> {
	return readYjsLogicDocument(ydoc, YJS_LIVE_DOCUMENT_FORMAT);
}
