import {
	GRID_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_PERSISTENCE_FORMAT,
	type SequitDiagnostic,
	SequitDiagnosticCode,
} from './logic-document';
import { parseOrderKey } from './order-key';

function invalidPresentation(
	diagnostics: SequitDiagnostic[],
	message: string,
	path: readonly string[],
): void {
	diagnostics.push({ code: SequitDiagnosticCode.InvalidValue, message, path });
}

function presentationEndpoints(document: LogicDocument) {
	return [
		...document.groups.map((item) => ({ collection: 'groups', item })),
		...document.nodes.map((item) => ({ collection: 'nodes', item })),
		...document.junctions.map((item) => ({ collection: 'junctions', item })),
	];
}

function validateAbsentLanePresentation(
	document: LogicDocument,
	diagnostics: SequitDiagnostic[],
): void {
	const presentationPath = ['presentation'];
	if (document.presentation !== undefined)
		invalidPresentation(
			diagnostics,
			'Legacy documents cannot persist explicit lanes',
			presentationPath,
		);
	for (const { collection, item } of presentationEndpoints(document))
		if (item.laneId !== undefined)
			invalidPresentation(diagnostics, 'Documents without lane presentation cannot assign lanes', [
				collection,
				item.id,
				'lane',
			]);
}

function validateLaneDefinitions(
	presentation: NonNullable<LogicDocument['presentation']>,
	diagnostics: SequitDiagnostic[],
): Set<string> {
	const schemaVersion: unknown = presentation.schemaVersion;
	const policy: unknown = presentation.policy;
	const growth: unknown = presentation.growth;
	if (schemaVersion !== LAYOUT_PRESENTATION_SCHEMA)
		invalidPresentation(diagnostics, 'Unsupported layout presentation schema', [
			'presentation',
			'schemaVersion',
		]);
	if (policy !== LayoutPolicy.Layered)
		invalidPresentation(diagnostics, 'Unsupported root layout policy', ['presentation', 'policy']);
	if (!Object.values(LaneOrientation).includes(presentation.laneOrientation))
		invalidPresentation(diagnostics, 'Unsupported lane orientation', [
			'presentation',
			'laneOrientation',
		]);
	if (growth !== LaneGrowth.Auto)
		invalidPresentation(diagnostics, 'Lanes must grow automatically', ['presentation', 'growth']);
	if (presentation.lanes.length < 2)
		invalidPresentation(diagnostics, 'Explicit lane layouts need at least two lanes', [
			'presentation',
			'lanes',
		]);
	const laneIds = new Set<string>();
	for (const lane of presentation.lanes) {
		if (lane.id.trim() === '' || laneIds.has(lane.id))
			invalidPresentation(diagnostics, `Duplicate or empty lane id: ${lane.id}`, [
				'presentation',
				'lanes',
				lane.id,
			]);
		laneIds.add(lane.id);
		if (parseOrderKey(lane.layoutOrder) === undefined)
			invalidPresentation(diagnostics, 'Lane layoutOrder must be a valid order key', [
				'presentation',
				'lanes',
				lane.id,
				'layoutOrder',
			]);
	}
	return laneIds;
}

function validateLaneOwners(
	document: LogicDocument,
	laneIds: ReadonlySet<string>,
	diagnostics: SequitDiagnostic[],
): void {
	for (const { collection, item } of presentationEndpoints(document)) {
		const path = [collection, item.id, 'lane'];
		if (item.groupId !== undefined) {
			if (item.laneId !== undefined)
				invalidPresentation(diagnostics, 'Group members inherit their lane', path);
			continue;
		}
		if (item.laneId === undefined)
			invalidPresentation(diagnostics, 'Top-level elements need a lane', path);
		else if (!laneIds.has(item.laneId))
			invalidPresentation(diagnostics, `Unknown lane: ${item.laneId}`, path);
	}
}

export function validateLaneDocument(
	document: LogicDocument,
	diagnostics: SequitDiagnostic[],
): void {
	if (document.persistenceFormat === PERSISTENCE_FORMAT) {
		validateAbsentLanePresentation(document, diagnostics);
		return;
	}
	if (
		document.persistenceFormat === REGION_LANE_PERSISTENCE_FORMAT ||
		document.persistenceFormat === REGION_COMPOSITION_PERSISTENCE_FORMAT
	) {
		if (document.presentation !== undefined)
			validateLaneDefinitions(document.presentation, diagnostics);
		return;
	}
	const presentation = document.presentation;
	if (presentation === undefined) {
		if (
			document.persistenceFormat !== REGION_PERSISTENCE_FORMAT &&
			document.persistenceFormat !== GRID_PERSISTENCE_FORMAT
		) {
			const presentationPath = ['presentation'];
			invalidPresentation(
				diagnostics,
				'Explicit lanes require presentation preferences',
				presentationPath,
			);
		} else validateAbsentLanePresentation(document, diagnostics);
		return;
	}
	const laneIds = validateLaneDefinitions(presentation, diagnostics);
	validateLaneOwners(document, laneIds, diagnostics);
}
