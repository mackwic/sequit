import * as Y from 'yjs';

import { compareCanonicalStrings } from '../canonical-string';
import {
	EndpointKind,
	LAYOUT_BIASES,
	LAYOUT_DIRECTIONS,
	layoutConfiguration,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNature,
	type LogicNode,
	type LogicRelation,
	type OrderKey,
	PERSISTENCE_FORMAT,
} from '../document/logic-document';
import { parseOrderKey } from '../document/order-key';
import { validateLogicDocument } from '../document/validate-logic-document';
import { createGraph } from '../graph/create-graph';

export const YJS_LIVE_DOCUMENT_FORMAT = 2 as const;

export interface YjsLiveDocumentDiagnostic {
	readonly code: 'unsupported-yjs-live-document-format' | 'invalid-yjs-live-document';
	readonly message: string;
	readonly path: readonly string[];
}

export type YjsLiveDocumentResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly diagnostics: readonly YjsLiveDocumentDiagnostic[] };

function validationFailure(
	diagnostics: readonly { readonly message: string; readonly path: readonly string[] }[],
): YjsLiveDocumentResult<LogicDocument> {
	return {
		ok: false,
		diagnostics: diagnostics.map(({ message, path }) => ({
			code: 'invalid-yjs-live-document',
			message,
			path,
		})),
	};
}

const META = 'sequit.meta';
const NATURES = 'sequit.natures';
const GROUPS = 'sequit.groups';
const NODES = 'sequit.nodes';
const JUNCTIONS = 'sequit.junctions';
const RELATIONS = 'sequit.relations';

function replaceMapContents(
	target: Y.Map<unknown>,
	values: Readonly<Record<string, unknown>>,
): void {
	target.clear();
	for (const [key, value] of Object.entries(values)) target.set(key, value);
}

function entityMap(values: Readonly<Record<string, unknown>>): Y.Map<unknown> {
	const result = new Y.Map<unknown>();
	for (const [key, value] of Object.entries(values)) result.set(key, value);
	return result;
}

function replaceEntityCollection<T extends { readonly id: string }>(
	target: Y.Map<Y.Map<unknown>>,
	entities: readonly T[],
	project: (entity: T) => Readonly<Record<string, unknown>>,
): void {
	target.clear();
	for (const entity of entities) target.set(entity.id, entityMap(project(entity)));
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
			({ label, groupId, layoutOrder }) => ({
				label,
				...(groupId === undefined ? {} : { groupId }),
				layoutOrder,
			}),
		);
		replaceEntityCollection(
			ydoc.getMap(NODES),
			document.nodes,
			({ natureId, groupId, markdown, layoutOrder }) => {
				const text = new Y.Text();
				text.insert(0, markdown);
				return {
					natureId,
					...(groupId === undefined ? {} : { groupId }),
					layoutOrder,
					markdown: text,
				};
			},
		);
		replaceEntityCollection(
			ydoc.getMap(JUNCTIONS),
			document.junctions,
			({ operator, groupId, layoutOrder }) => ({
				operator,
				...(groupId === undefined ? {} : { groupId }),
				layoutOrder,
			}),
		);
		replaceEntityCollection(ydoc.getMap(RELATIONS), document.relations, ({ from, to }) => ({
			from,
			to,
		}));
	}, origin);
}

interface ReadContext {
	readonly diagnostics: YjsLiveDocumentDiagnostic[];
}

function readString(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): string | undefined {
	if (typeof value === 'string') return value;
	context.diagnostics.push({
		code: 'invalid-yjs-live-document',
		message: `${path.join('.')} must be a string`,
		path,
	});
	return undefined;
}

function readOptionalString(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): string | undefined {
	return value === undefined ? undefined : readString(value, path, context);
}

function readRequiredLayoutOrder(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): OrderKey | undefined {
	const key = readString(value, path, context);
	if (key === undefined) return undefined;
	const parsed = parseOrderKey(key);
	if (parsed !== undefined) return parsed;
	context.diagnostics.push({
		code: 'invalid-yjs-live-document',
		message: `${path.join('.')} must be a valid fractional order key`,
		path,
	});
	return undefined;
}

function sortedKeys<T>(map: Y.Map<T>): readonly string[] {
	return [...map.keys()].sort(compareCanonicalStrings);
}

function readEntity(
	collection: Y.Map<Y.Map<unknown>>,
	id: string,
	collectionName: string,
	context: ReadContext,
): Y.Map<unknown> | undefined {
	const value = collection.get(id);
	if (value instanceof Y.Map) return value;
	context.diagnostics.push({
		code: 'invalid-yjs-live-document',
		message: `${collectionName}.${id} must be a Y.Map`,
		path: [collectionName, id],
	});
	return undefined;
}
function readCollection<T>(
	ydoc: Y.Doc,
	sharedName: string,
	collectionName: string,
	context: ReadContext,
	project: (entity: Y.Map<unknown>, id: string, context: ReadContext) => T | undefined,
): T[] {
	const collection = ydoc.getMap<Y.Map<unknown>>(sharedName);
	const result: T[] = [];
	for (const id of sortedKeys(collection)) {
		const entity = readEntity(collection, id, collectionName, context);
		if (!entity) continue;
		const value = project(entity, id, context);
		if (value !== undefined) result.push(value);
	}
	return result;
}

function readNature(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): LogicNature | undefined {
	const label = readString(entity.get('label'), ['natures', id, 'label'], context);
	const color = readString(entity.get('color'), ['natures', id, 'color'], context);
	return label === undefined || color === undefined ? undefined : { id, label, color };
}

function readGroup(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): LogicGroup | undefined {
	const label = readString(entity.get('label'), ['groups', id, 'label'], context);
	const groupId = readOptionalString(entity.get('groupId'), ['groups', id, 'group'], context);
	const layoutOrder = readRequiredLayoutOrder(
		entity.get('layoutOrder'),
		['groups', id, 'layoutOrder'],
		context,
	);
	return label === undefined || layoutOrder === undefined
		? undefined
		: {
				kind: EndpointKind.Group,
				id,
				label,
				...(groupId === undefined ? {} : { groupId }),
				layoutOrder,
			};
}

function readNode(entity: Y.Map<unknown>, id: string, context: ReadContext): LogicNode | undefined {
	const natureId = readString(entity.get('natureId'), ['nodes', id, 'nature'], context);
	const groupId = readOptionalString(entity.get('groupId'), ['nodes', id, 'group'], context);
	const markdown = entity.get('markdown');
	const layoutOrder = readRequiredLayoutOrder(
		entity.get('layoutOrder'),
		['nodes', id, 'layoutOrder'],
		context,
	);
	if (!(markdown instanceof Y.Text)) {
		context.diagnostics.push({
			code: 'invalid-yjs-live-document',
			message: `nodes.${id}.markdown must be a Y.Text`,
			path: ['nodes', id, 'markdown'],
		});
		return undefined;
	}
	if (natureId === undefined || layoutOrder === undefined) return undefined;
	return {
		kind: EndpointKind.Node,
		id,
		natureId,
		...(groupId === undefined ? {} : { groupId }),
		markdown: markdown.toJSON(),
		layoutOrder,
	};
}

function readJunction(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): LogicJunction | undefined {
	const operator = readString(entity.get('operator'), ['junctions', id, 'operator'], context);
	const groupId = readOptionalString(entity.get('groupId'), ['junctions', id, 'group'], context);
	const layoutOrder = readRequiredLayoutOrder(
		entity.get('layoutOrder'),
		['junctions', id, 'layoutOrder'],
		context,
	);
	if (operator === 'xor' && layoutOrder !== undefined) {
		return {
			kind: EndpointKind.Junction,
			id,
			operator,
			...(groupId === undefined ? {} : { groupId }),
			layoutOrder,
		};
	}
	if (operator !== undefined && operator !== 'xor') {
		context.diagnostics.push({
			code: 'invalid-yjs-live-document',
			message: `Unsupported junction operator: ${operator}`,
			path: ['junctions', id, 'operator'],
		});
	}
	return undefined;
}

function readRelation(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): LogicRelation | undefined {
	const from = readString(entity.get('from'), ['relations', id, 'from'], context);
	const to = readString(entity.get('to'), ['relations', id, 'to'], context);
	return from === undefined || to === undefined ? undefined : { id, from, to };
}

export function readLogicDocument(ydoc: Y.Doc): YjsLiveDocumentResult<LogicDocument> {
	const meta = ydoc.getMap<unknown>(META);
	const version = meta.get('yjsLiveDocumentFormat');
	if (version !== YJS_LIVE_DOCUMENT_FORMAT) {
		return {
			ok: false,
			diagnostics: [
				{
					code: 'unsupported-yjs-live-document-format',
					message: `Unsupported yjsLiveDocumentFormat: ${String(version)}`,
					path: ['yjsLiveDocumentFormat'],
				},
			],
		};
	}

	const context: ReadContext = { diagnostics: [] };
	const id = readString(meta.get('id'), ['document', 'id'], context);
	const title = readString(meta.get('title'), ['document', 'title'], context);
	const layoutDirection = readString(meta.get('layoutDirection'), ['layout', 'direction'], context);
	const layoutBias = readString(meta.get('layoutBias'), ['layout', 'bias'], context);
	if (meta.get('persistenceFormat') !== PERSISTENCE_FORMAT) {
		context.diagnostics.push({
			code: 'invalid-yjs-live-document',
			message: `Unsupported imported persistenceFormat: ${String(meta.get('persistenceFormat'))}`,
			path: ['persistenceFormat'],
		});
	}
	const direction = LAYOUT_DIRECTIONS.find((candidate) => candidate === layoutDirection);
	const bias = LAYOUT_BIASES.find((candidate) => candidate === layoutBias);
	if (layoutDirection !== undefined && direction === undefined) {
		context.diagnostics.push({
			code: 'invalid-yjs-live-document',
			message: `Unsupported layout direction: ${layoutDirection}`,
			path: ['layout', 'direction'],
		});
	}
	if (layoutBias !== undefined && bias === undefined) {
		context.diagnostics.push({
			code: 'invalid-yjs-live-document',
			message: `Unsupported layout bias: ${layoutBias}`,
			path: ['layout', 'bias'],
		});
	}
	const layout =
		direction === undefined || bias === undefined
			? undefined
			: layoutConfiguration(direction, bias);
	if (direction !== undefined && bias !== undefined && layout === undefined) {
		context.diagnostics.push({
			code: 'invalid-yjs-live-document',
			message: `Layout bias ${bias} is incompatible with direction ${direction}`,
			path: ['layout', 'bias'],
		});
	}

	const natures = readCollection(ydoc, NATURES, 'natures', context, readNature);
	const groups = readCollection(ydoc, GROUPS, 'groups', context, readGroup);
	const nodes = readCollection(ydoc, NODES, 'nodes', context, readNode);
	const junctions = readCollection(ydoc, JUNCTIONS, 'junctions', context, readJunction);
	const relations = readCollection(ydoc, RELATIONS, 'relations', context, readRelation);

	if (context.diagnostics.length > 0 || id === undefined || title === undefined || !layout) {
		return { ok: false, diagnostics: context.diagnostics };
	}
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id,
		title,
		layout,
		natures,
		groups,
		nodes,
		junctions,
		relations,
	};
	const validated = validateLogicDocument(document);
	if (!validated.ok) {
		return {
			ok: false,
			diagnostics: validated.diagnostics.map(({ message, path }) => ({
				code: 'invalid-yjs-live-document',
				message,
				path,
			})),
		};
	}
	const graph = createGraph(validated.value);
	return graph.ok
		? { ok: true, value: graph.value.document }
		: validationFailure(graph.diagnostics);
}
