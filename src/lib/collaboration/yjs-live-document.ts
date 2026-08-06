import * as Y from 'yjs';

import {
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
} from '../document/logic-document';
import { validateLogicDocument } from '../document/validate-logic-document';

export const YJS_LIVE_DOCUMENT_FORMAT = 2 as const;

enum YjsLiveDocumentDiagnosticCode {
	UnsupportedFormat = 'unsupported-yjs-live-document-format',
	InvalidDocument = 'invalid-yjs-live-document',
}

interface YjsLiveDocumentDiagnostic {
	readonly code: YjsLiveDocumentDiagnosticCode;
	readonly message: string;
	readonly path: readonly string[];
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

export function importLogicDocument(ydoc: Y.Doc, document: LogicDocument): void {
	ydoc.transact(() => {
		replaceMapContents(ydoc.getMap(META), {
			yjsLiveDocumentFormat: YJS_LIVE_DOCUMENT_FORMAT,
			id: document.id,
			title: document.title,
			layoutDirection: document.layout.direction,
			layoutBias: document.layout.bias,
		});
		replaceEntityCollection(ydoc.getMap(NATURES), document.natures, ({ label, color }) => ({
			label,
			color,
		}));
		replaceEntityCollection(ydoc.getMap(GROUPS), document.groups, ({ label, groupId }) => {
			const values: { label: string; groupId?: string } = { label };
			if (groupId !== undefined) values.groupId = groupId;
			return values;
		});
		replaceEntityCollection(
			ydoc.getMap(NODES),
			document.nodes,
			({ natureId, groupId, markdown }) => {
				const text = new Y.Text();
				text.insert(0, markdown);
				const values: { natureId: string; groupId?: string; markdown: Y.Text } = {
					natureId,
					markdown: text,
				};
				if (groupId !== undefined) values.groupId = groupId;
				return values;
			},
		);
		replaceEntityCollection(ydoc.getMap(JUNCTIONS), document.junctions, ({ operator, groupId }) => {
			const values: { operator: string; groupId?: string } = { operator };
			if (groupId !== undefined) values.groupId = groupId;
			return values;
		});
		replaceEntityCollection(ydoc.getMap(RELATIONS), document.relations, ({ from, to }) => ({
			from,
			to,
		}));
	}, 'sequit:import');
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
		code: YjsLiveDocumentDiagnosticCode.InvalidDocument,
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

function sortedKeys<T>(map: Y.Map<T>): readonly string[] {
	return [...map.keys()].sort((left, right) => left.localeCompare(right));
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
		code: YjsLiveDocumentDiagnosticCode.InvalidDocument,
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
	if (label === undefined) return undefined;
	const group: { id: string; label: string; groupId?: string } = { id, label };
	if (groupId !== undefined) group.groupId = groupId;
	return group;
}

function readNode(entity: Y.Map<unknown>, id: string, context: ReadContext): LogicNode | undefined {
	const natureId = readString(entity.get('natureId'), ['nodes', id, 'nature'], context);
	const groupId = readOptionalString(entity.get('groupId'), ['nodes', id, 'group'], context);
	const markdown = entity.get('markdown');
	if (!(markdown instanceof Y.Text)) {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.InvalidDocument,
			message: `nodes.${id}.markdown must be a Y.Text`,
			path: ['nodes', id, 'markdown'],
		});
		return undefined;
	}
	if (natureId === undefined) return undefined;
	const node: { id: string; natureId: string; groupId?: string; markdown: string } = {
		id,
		natureId,
		markdown: markdown.toJSON(),
	};
	if (groupId !== undefined) node.groupId = groupId;
	return node;
}

function readJunction(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): LogicJunction | undefined {
	const operator = readString(entity.get('operator'), ['junctions', id, 'operator'], context);
	const groupId = readOptionalString(entity.get('groupId'), ['junctions', id, 'group'], context);
	if (operator === JunctionOperator.Xor) {
		const junction: { id: string; operator: JunctionOperator; groupId?: string } = {
			id,
			operator: JunctionOperator.Xor,
		};
		if (groupId !== undefined) junction.groupId = groupId;
		return junction;
	}
	if (operator !== undefined) {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.InvalidDocument,
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

export function readLogicDocument(ydoc: Y.Doc): YjsLiveDocumentResult<LogicDocument> {
	const meta = ydoc.getMap<unknown>(META);
	const version = meta.get('yjsLiveDocumentFormat');
	if (version !== YJS_LIVE_DOCUMENT_FORMAT) {
		return {
			ok: false,
			diagnostics: [
				{
					code: YjsLiveDocumentDiagnosticCode.UnsupportedFormat,
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
	const direction = LAYOUT_DIRECTIONS.find((candidate) => candidate === layoutDirection);
	const bias = LAYOUT_BIASES.find((candidate) => candidate === layoutBias);
	if (layoutDirection !== undefined && direction === undefined) {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.InvalidDocument,
			message: `Unsupported layout direction: ${layoutDirection}`,
			path: ['layout', 'direction'],
		});
	}
	if (layoutBias !== undefined && bias === undefined) {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.InvalidDocument,
			message: `Unsupported layout bias: ${layoutBias}`,
			path: ['layout', 'bias'],
		});
	}
	const hasLayoutInputs = direction !== undefined && bias !== undefined;
	let layout: LogicDocument['layout'] | undefined;
	if (hasLayoutInputs) layout = layoutConfiguration(direction, bias);
	if (hasLayoutInputs && layout === undefined) {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.InvalidDocument,
			message: `Layout bias ${bias} is incompatible with direction ${direction}`,
			path: ['layout', 'bias'],
		});
	}

	const natures = readCollection(ydoc, NATURES, 'natures', context, readNature);
	const groups = readCollection(ydoc, GROUPS, 'groups', context, readGroup);
	const nodes = readCollection(ydoc, NODES, 'nodes', context, readNode);
	const junctions = readCollection(ydoc, JUNCTIONS, 'junctions', context, readJunction);
	const relations = readCollection(ydoc, RELATIONS, 'relations', context, readRelation);

	if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics };
	if (id === undefined || title === undefined) {
		return { ok: false, diagnostics: context.diagnostics };
	}
	if (!layout) return { ok: false, diagnostics: context.diagnostics };

	const document: LogicDocument = {
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
	if (validated.ok) return { ok: true, value: validated.value };
	return {
		ok: false,
		diagnostics: validated.diagnostics.map(({ message, path }) => ({
			code: YjsLiveDocumentDiagnosticCode.InvalidDocument,
			message,
			path,
		})),
	};
}

export function replaceNodeMarkdown(ydoc: Y.Doc, nodeId: string, markdown: string): boolean {
	const node = ydoc.getMap<Y.Map<unknown>>(NODES).get(nodeId);
	const text = node?.get('markdown');
	if (!(text instanceof Y.Text)) return false;

	ydoc.transact(() => {
		text.delete(0, text.length);
		text.insert(0, markdown);
	}, 'sequit:replace-node-markdown');
	return true;
}
