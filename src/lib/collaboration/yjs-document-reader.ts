import * as Y from 'yjs';

import { compareCanonicalStrings } from '../canonical-string';
import {
	EndpointKind,
	JunctionOperator,
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
import { YJS_COLLECTIONS } from './yjs-document-schema';

const XOR_OPERATOR: string = JunctionOperator.Xor;

interface YjsLiveDocumentDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
	readonly expectedOrder?: readonly string[];
	readonly materializedOrder?: readonly string[];
	readonly expectedScore?: number;
	readonly materializedScore?: number;
}

interface YjsLiveDocumentSuccess<T> {
	readonly ok: true;
	readonly value: T;
}

interface YjsLiveDocumentFailure {
	readonly ok: false;
	readonly diagnostics: readonly YjsLiveDocumentDiagnostic[];
}

export type YjsLiveDocumentResult<T> = YjsLiveDocumentSuccess<T> | YjsLiveDocumentFailure;

interface ReadContext {
	readonly diagnostics: YjsLiveDocumentDiagnostic[];
}

interface CollectionOptions<T> {
	readonly sharedName: string;
	readonly collectionName: string;
	readonly project: (entity: Y.Map<unknown>, id: string, context: ReadContext) => T | undefined;
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
	if (value === undefined) return undefined;
	return readString(value, path, context);
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

function readCollection<T>(ydoc: Y.Doc, context: ReadContext, options: CollectionOptions<T>): T[] {
	const collection = ydoc.getMap<Y.Map<unknown>>(options.sharedName);
	const result: T[] = [];
	for (const id of [...collection.keys()].sort(compareCanonicalStrings)) {
		const entity = collection.get(id);
		if (!(entity instanceof Y.Map)) {
			context.diagnostics.push({
				code: 'invalid-yjs-live-document',
				message: `${options.collectionName}.${id} must be a Y.Map`,
				path: [options.collectionName, id],
			});
			continue;
		}
		const value = options.project(entity, id, context);
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
	if (label === undefined || color === undefined) return undefined;
	return { id, label, color };
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
	if (label === undefined || layoutOrder === undefined) return undefined;
	const group: LogicGroup = { kind: EndpointKind.Group, id, label, layoutOrder };
	if (groupId === undefined) return group;
	return { ...group, groupId };
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
	const node: LogicNode = {
		kind: EndpointKind.Node,
		id,
		natureId,
		markdown: markdown.toJSON(),
		layoutOrder,
	};
	if (groupId === undefined) return node;
	return { ...node, groupId };
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
	if (operator === XOR_OPERATOR && layoutOrder !== undefined) {
		const junction: LogicJunction = {
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder,
		};
		if (groupId === undefined) return junction;
		return { ...junction, groupId };
	}
	if (operator !== undefined && operator !== XOR_OPERATOR) {
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
	if (from === undefined || to === undefined) return undefined;
	return { id, from, to };
}

function validationFailure(
	diagnostics: readonly { readonly message: string; readonly path: readonly string[] }[],
): YjsLiveDocumentFailure {
	return {
		ok: false,
		diagnostics: diagnostics.map(({ message, path }) => ({
			code: 'invalid-yjs-live-document',
			message,
			path,
		})),
	};
}

export function readYjsLogicDocument(
	ydoc: Y.Doc,
	liveDocumentFormat: number,
): YjsLiveDocumentResult<LogicDocument> {
	const meta = ydoc.getMap<unknown>(YJS_COLLECTIONS.meta);
	const version = meta.get('yjsLiveDocumentFormat');
	if (version !== liveDocumentFormat) {
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
	let layout;
	if (direction !== undefined && bias !== undefined) layout = layoutConfiguration(direction, bias);
	const recognizedLayoutValues = direction !== undefined && bias !== undefined;
	if (recognizedLayoutValues && layout === undefined) {
		context.diagnostics.push({
			code: 'invalid-yjs-live-document',
			message: `Layout bias ${bias} is incompatible with direction ${direction}`,
			path: ['layout', 'bias'],
		});
	}
	const natures = readCollection(ydoc, context, {
		sharedName: YJS_COLLECTIONS.natures,
		collectionName: 'natures',
		project: readNature,
	});
	const groups = readCollection(ydoc, context, {
		sharedName: YJS_COLLECTIONS.groups,
		collectionName: 'groups',
		project: readGroup,
	});
	const nodes = readCollection(ydoc, context, {
		sharedName: YJS_COLLECTIONS.nodes,
		collectionName: 'nodes',
		project: readNode,
	});
	const junctions = readCollection(ydoc, context, {
		sharedName: YJS_COLLECTIONS.junctions,
		collectionName: 'junctions',
		project: readJunction,
	});
	const relations = readCollection(ydoc, context, {
		sharedName: YJS_COLLECTIONS.relations,
		collectionName: 'relations',
		project: readRelation,
	});
	const hasDiagnostics = context.diagnostics.length > 0;
	const missingDocumentIdentity = id === undefined || title === undefined;
	if (hasDiagnostics || missingDocumentIdentity || layout === undefined) {
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
	if (!validated.ok) return validationFailure(validated.diagnostics);
	const graph = createGraph(validated.value);
	if (!graph.ok) return validationFailure(graph.diagnostics);
	return { ok: true, value: graph.value.document };
}
