import * as Y from 'yjs';

import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
	type RootLayoutPresentation,
} from '../../core/document/logic-document';
import { type ReadContext, YjsLiveDocumentDiagnosticCode } from './yjs-document-result';
import {
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_LANE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YjsCollection,
} from './yjs-document-schema';
import { readRequiredLayoutOrder, readString, readText } from './yjs-field-readers';

interface CollectionOptions<T> {
	readonly sharedName: string;
	readonly collectionName: string;
	readonly project: (entity: Y.Map<unknown>, id: string, context: ReadContext) => T | undefined;
}

export function readCollection<T>(
	ydoc: Y.Doc,
	context: ReadContext,
	options: CollectionOptions<T>,
): T[] {
	const collection = ydoc.getMap<Y.Map<unknown>>(options.sharedName);
	const result: T[] = [];
	for (const id of [...collection.keys()].sort(compareCanonicalStrings)) {
		const entity = collection.get(id);
		if (!(entity instanceof Y.Map)) {
			context.diagnostics.push({
				code: YjsLiveDocumentDiagnosticCode.Invalid,
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

const orientationByValue: Readonly<Record<string, LaneOrientation>> = {
	[LaneOrientation.Parallel]: LaneOrientation.Parallel,
	[LaneOrientation.Transverse]: LaneOrientation.Transverse,
};
const policyByValue: Readonly<Record<string, LayoutPolicy>> = {
	[LayoutPolicy.Layered]: LayoutPolicy.Layered,
};
const growthByValue: Readonly<Record<string, LaneGrowth>> = {
	[LaneGrowth.Auto]: LaneGrowth.Auto,
};
const OPTIONAL_ROOT_PRESENTATION_FORMATS = new Set<number>([
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
]);

function readLane(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): RootLayoutPresentation['lanes'][number] | undefined {
	const label = readText(entity.get('label'), ['presentation', 'lanes', id, 'label'], context);
	const layoutOrder = readRequiredLayoutOrder(
		entity.get('layoutOrder'),
		['presentation', 'lanes', id, 'layoutOrder'],
		context,
	);
	if (label === undefined || layoutOrder === undefined) return undefined;
	return { id, label, layoutOrder };
}

function invalidValue(context: ReadContext, message: string, path: readonly string[]): void {
	context.diagnostics.push({ code: YjsLiveDocumentDiagnosticCode.Invalid, message, path });
}

function readPresentation(
	ydoc: Y.Doc,
	meta: Y.Map<unknown>,
	context: ReadContext,
): RootLayoutPresentation | undefined {
	const schema = meta.get('layoutPresentationSchema');
	const validSchema = schema === LAYOUT_PRESENTATION_SCHEMA;
	if (!validSchema)
		invalidValue(context, `Unsupported layout presentation schema: ${String(schema)}`, [
			'presentation',
			'schemaVersion',
		]);
	const policy = readString(meta.get('rootLayoutPolicy'), ['presentation', 'policy'], context);
	const validPolicy = policy !== undefined && policyByValue[policy] !== undefined;
	if (policy !== undefined && !validPolicy)
		invalidValue(context, `Unsupported root layout policy: ${policy}`, ['presentation', 'policy']);
	const orientationValue = readString(
		meta.get('laneOrientation'),
		['presentation', 'laneOrientation'],
		context,
	);
	let orientation: LaneOrientation | undefined;
	if (orientationValue !== undefined) orientation = orientationByValue[orientationValue];
	if (orientationValue !== undefined && orientation === undefined)
		invalidValue(context, `Unsupported lane orientation: ${orientationValue}`, [
			'presentation',
			'laneOrientation',
		]);
	const growth = readString(meta.get('laneGrowth'), ['presentation', 'growth'], context);
	const validGrowth = growth !== undefined && growthByValue[growth] !== undefined;
	if (growth !== undefined && !validGrowth)
		invalidValue(context, `Unsupported lane growth policy: ${growth}`, ['presentation', 'growth']);
	const lanes = readCollection(ydoc, context, {
		sharedName: YjsCollection.Lanes,
		collectionName: 'presentation.lanes',
		project: readLane,
	});
	const valid = [validSchema, validPolicy, orientation !== undefined, validGrowth].every(Boolean);
	if (!valid || orientation === undefined) return undefined;
	return {
		schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
		policy: LayoutPolicy.Layered,
		laneOrientation: orientation,
		growth: LaneGrowth.Auto,
		lanes,
	};
}

export function readVersionedPresentation(
	ydoc: Y.Doc,
	meta: Y.Map<unknown>,
	version: number,
	context: ReadContext,
): RootLayoutPresentation | undefined {
	if (version === YJS_LANE_DOCUMENT_FORMAT) return readPresentation(ydoc, meta, context);
	const hasLaneCollection = ydoc.getMap(YjsCollection.Lanes).size > 0;
	const hasPresentationMetadata = [
		'layoutPresentationSchema',
		'rootLayoutPolicy',
		'laneOrientation',
		'laneGrowth',
	].some((key) => meta.has(key));
	if (OPTIONAL_ROOT_PRESENTATION_FORMATS.has(version)) {
		if (!hasLaneCollection && !hasPresentationMetadata) return undefined;
		return readPresentation(ydoc, meta, context);
	}
	if (hasLaneCollection || hasPresentationMetadata)
		invalidValue(context, 'Legacy shared documents cannot persist explicit lanes', [
			'presentation',
		]);
	return undefined;
}
