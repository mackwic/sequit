import * as Y from 'yjs';

import {
	type ContentStyle,
	contentStyleFields,
	EndpointKind,
	GRID_PERSISTENCE_FORMAT,
	JUNCTION_OPERATORS,
	LANE_PERSISTENCE_FORMAT,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNature,
	type LogicNode,
	type LogicRelation,
	nodeDescriptionFields,
	PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_PERSISTENCE_FORMAT,
	type RegionLayoutPresentation,
	type RootLayoutPresentation,
} from '../../core/document/logic-document';
import { validateLogicDocument } from '../../core/document/validate-logic-document';
import { readSharedLayout } from './yjs-document-layout';
import { readCollection, readVersionedPresentation } from './yjs-document-presentation';
import { readVersionedRegionPresentation } from './yjs-document-regions';
import {
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_LANE_DOCUMENT_FORMAT,
	YJS_LIVE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YjsCollection,
} from './yjs-document-schema';
import {
	readOptionalString,
	readOptionalText,
	readRequiredLayoutOrder,
	readString,
	readText,
} from './yjs-field-readers';
import { readGroupState } from './yjs-group-state';

export { YjsLiveDocumentDiagnosticCode, type YjsLiveDocumentResult } from './yjs-document-result';
import {
	type ReadContext,
	YjsLiveDocumentDiagnosticCode,
	type YjsLiveDocumentFailure,
	type YjsLiveDocumentResult,
} from './yjs-document-result';

function readContentStyle(
	entity: Y.Map<unknown>,
	path: readonly string[],
	context: ReadContext,
): ContentStyle {
	return contentStyleFields(
		readOptionalString(entity.get('color'), [...path, 'color'], context),
		readOptionalString(entity.get('icon'), [...path, 'icon'], context),
	);
}

function readNature(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): LogicNature | undefined {
	const label = readText(entity.get('label'), ['natures', id, 'label'], context);
	const color = readString(entity.get('color'), ['natures', id, 'color'], context);
	const style = readContentStyle(entity, ['natures', id], context);
	if (label === undefined || color === undefined) return undefined;
	return { id, label, ...style, color };
}

function readGroup(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): LogicGroup | undefined {
	const label = readText(entity.get('label'), ['groups', id, 'label'], context);
	const color = readOptionalString(entity.get('color'), ['groups', id, 'color'], context);
	const groupId = readOptionalString(entity.get('groupId'), ['groups', id, 'group'], context);
	const laneId = readOptionalString(entity.get('laneId'), ['groups', id, 'lane'], context);
	const regionId = readOptionalString(entity.get('regionId'), ['groups', id, 'regionId'], context);
	const layoutOrder = readRequiredLayoutOrder(
		entity.get('layoutOrder'),
		['groups', id, 'layoutOrder'],
		context,
	);
	if (label === undefined || layoutOrder === undefined) return undefined;
	const group: LogicGroup = {
		kind: EndpointKind.Group,
		id,
		label,
		...contentStyleFields(color, undefined),
		layoutOrder,
		...readGroupState(entity, id, context),
	};
	const ownership: { groupId?: string; laneId?: string; regionId?: string } = {};
	if (groupId !== undefined) ownership.groupId = groupId;
	if (laneId !== undefined) ownership.laneId = laneId;
	if (regionId !== undefined) ownership.regionId = regionId;
	return { ...group, ...ownership };
}

function readNode(entity: Y.Map<unknown>, id: string, context: ReadContext): LogicNode | undefined {
	const natureId = readString(entity.get('natureId'), ['nodes', id, 'nature'], context);
	const style = readContentStyle(entity, ['nodes', id], context);
	const groupId = readOptionalString(entity.get('groupId'), ['nodes', id, 'group'], context);
	const laneId = readOptionalString(entity.get('laneId'), ['nodes', id, 'lane'], context);
	const regionId = readOptionalString(entity.get('regionId'), ['nodes', id, 'regionId'], context);
	const markdown = entity.get('markdown');
	const layoutOrder = readRequiredLayoutOrder(
		entity.get('layoutOrder'),
		['nodes', id, 'layoutOrder'],
		context,
	);
	if (!(markdown instanceof Y.Text)) {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message: `nodes.${id}.markdown must be a Y.Text`,
			path: ['nodes', id, 'markdown'],
		});
		return undefined;
	}
	if (natureId === undefined || layoutOrder === undefined) return undefined;
	const node: LogicNode = {
		...style,
		...nodeDescriptionFields(
			readOptionalText(entity.get('description'), ['nodes', id, 'description'], context),
		),
		kind: EndpointKind.Node,
		id,
		natureId,
		markdown: markdown.toJSON(),
		layoutOrder,
	};
	const ownership: { groupId?: string; laneId?: string; regionId?: string } = {};
	if (groupId !== undefined) ownership.groupId = groupId;
	if (laneId !== undefined) ownership.laneId = laneId;
	if (regionId !== undefined) ownership.regionId = regionId;
	return { ...node, ...ownership };
}

function readJunction(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): LogicJunction | undefined {
	const operatorValue = readString(entity.get('operator'), ['junctions', id, 'operator'], context);
	const operator = JUNCTION_OPERATORS.find((candidate: string) => candidate === operatorValue);
	const groupId = readOptionalString(entity.get('groupId'), ['junctions', id, 'group'], context);
	const laneId = readOptionalString(entity.get('laneId'), ['junctions', id, 'lane'], context);
	const regionId = readOptionalString(
		entity.get('regionId'),
		['junctions', id, 'regionId'],
		context,
	);
	const layoutOrder = readRequiredLayoutOrder(
		entity.get('layoutOrder'),
		['junctions', id, 'layoutOrder'],
		context,
	);
	if (operator !== undefined && layoutOrder !== undefined) {
		const junction: LogicJunction = {
			kind: EndpointKind.Junction,
			id,
			operator,
			layoutOrder,
		};
		const ownership: { groupId?: string; laneId?: string; regionId?: string } = {};
		if (groupId !== undefined) ownership.groupId = groupId;
		if (laneId !== undefined) ownership.laneId = laneId;
		if (regionId !== undefined) ownership.regionId = regionId;
		return { ...junction, ...ownership };
	}
	if (operatorValue !== undefined && operator === undefined) {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message: `Unsupported junction operator: ${operatorValue}`,
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
	diagnostics: readonly {
		readonly message: string;
		readonly path: readonly string[];
	}[],
): YjsLiveDocumentFailure {
	return {
		ok: false,
		diagnostics: diagnostics.map(({ message, path }) => ({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message,
			path,
		})),
	};
}

const SUPPORTED_YJS_FORMATS = new Set<number>([
	YJS_LIVE_DOCUMENT_FORMAT,
	YJS_LANE_DOCUMENT_FORMAT,
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
]);

const REGION_YJS_FORMATS = new Set<number>([
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
]);

function persistenceFormatFor(version: number): LogicDocument['persistenceFormat'] {
	if (version === YJS_LANE_DOCUMENT_FORMAT) return LANE_PERSISTENCE_FORMAT;
	if (version === YJS_REGION_DOCUMENT_FORMAT) return REGION_PERSISTENCE_FORMAT;
	if (version === YJS_GRID_DOCUMENT_FORMAT) return GRID_PERSISTENCE_FORMAT;
	if (version === YJS_REGION_LANE_DOCUMENT_FORMAT) return REGION_LANE_PERSISTENCE_FORMAT;
	if (version === YJS_REGION_COMPOSITION_DOCUMENT_FORMAT)
		return REGION_COMPOSITION_PERSISTENCE_FORMAT;
	return PERSISTENCE_FORMAT;
}

export function readStructuralLogicDocument(ydoc: Y.Doc): YjsLiveDocumentResult<LogicDocument> {
	const meta = ydoc.getMap<unknown>(YjsCollection.Meta);
	const version = meta.get('yjsLiveDocumentFormat');
	const supportedVersion = typeof version === 'number' && SUPPORTED_YJS_FORMATS.has(version);
	if (!supportedVersion) {
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
	const title = readText(meta.get('title'), ['document', 'title'], context);
	const layout = readSharedLayout(meta, context);
	const persistenceFormat = meta.get('persistenceFormat');
	const expectedPersistenceFormat = persistenceFormatFor(version);
	if (persistenceFormat !== expectedPersistenceFormat) {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message: `Unsupported imported persistenceFormat: ${String(persistenceFormat)}`,
			path: ['persistenceFormat'],
		});
	}
	const natures = readCollection(ydoc, context, {
		sharedName: YjsCollection.Natures,
		collectionName: 'natures',
		project: readNature,
	});
	const groups = readCollection(ydoc, context, {
		sharedName: YjsCollection.Groups,
		collectionName: 'groups',
		project: readGroup,
	});
	const nodes = readCollection(ydoc, context, {
		sharedName: YjsCollection.Nodes,
		collectionName: 'nodes',
		project: readNode,
	});
	const junctions = readCollection(ydoc, context, {
		sharedName: YjsCollection.Junctions,
		collectionName: 'junctions',
		project: readJunction,
	});
	const relations = readCollection(ydoc, context, {
		sharedName: YjsCollection.Relations,
		collectionName: 'relations',
		project: readRelation,
	});
	const presentation = readVersionedPresentation(ydoc, meta, version, context);
	const regionPresentation = readVersionedRegionPresentation(ydoc, meta, version, context);
	const missingPresentation = version === YJS_LANE_DOCUMENT_FORMAT && presentation === undefined;
	const regionVersion = REGION_YJS_FORMATS.has(version);
	const missingRegions = regionVersion && regionPresentation === undefined;
	if (context.diagnostics.length > 0 || missingPresentation || missingRegions)
		return { ok: false, diagnostics: context.diagnostics };
	if (id === undefined) return { ok: false, diagnostics: context.diagnostics };
	if (title === undefined) return { ok: false, diagnostics: context.diagnostics };
	if (layout === undefined) {
		return { ok: false, diagnostics: context.diagnostics };
	}
	const presentationField: { presentation?: RootLayoutPresentation } = {};
	if (presentation !== undefined) presentationField.presentation = presentation;
	const regionPresentationField: { regionPresentation?: RegionLayoutPresentation } = {};
	if (regionPresentation !== undefined)
		regionPresentationField.regionPresentation = regionPresentation;
	const document: LogicDocument = {
		persistenceFormat: expectedPersistenceFormat,
		id,
		title,
		layout,
		...presentationField,
		...regionPresentationField,
		natures,
		groups,
		nodes,
		junctions,
		relations,
	};
	const validated = validateLogicDocument(document);
	if (!validated.ok) return validationFailure(validated.diagnostics);
	return { ok: true, value: validated.value };
}
