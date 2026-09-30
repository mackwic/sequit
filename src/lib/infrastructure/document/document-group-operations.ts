import { placeJunctions } from '../../core/document/junction-placement';
import { normalizeRootLayout } from '../../core/document/layout-presentation';
import {
	defined,
	EndpointKind,
	GRID_PERSISTENCE_FORMAT,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_PERSISTENCE_FORMAT,
	REGION_POLICY_PERSISTENCE_FORMAT,
} from '../../core/document/logic-document';
import {
	normalizeRegionPresentation,
	RegionPresentationStatus,
	ROOT_LAYOUT_REGION_ID,
} from '../../core/document/region-presentation';
import { fractionalOrderKeySpace } from '../../core/ordering/order-key-space';

function hasRegionPresentation(document: LogicDocument): boolean {
	const regionFormats: readonly number[] = [
		REGION_PERSISTENCE_FORMAT,
		GRID_PERSISTENCE_FORMAT,
		REGION_LANE_PERSISTENCE_FORMAT,
		REGION_COMPOSITION_PERSISTENCE_FORMAT,
		REGION_POLICY_PERSISTENCE_FORMAT,
	];
	return regionFormats.includes(document.persistenceFormat);
}

function hasLanePresentation(document: LogicDocument, regionId: string): boolean {
	return (
		document.presentation !== undefined ||
		document.regionPresentation?.regions.some(
			(region) => region.id === regionId && region.lanePresentation !== undefined,
		) === true
	);
}

export function groupDocumentNodes(
	document: LogicDocument,
	group: { readonly id: string; readonly label: string },
	ids: ReadonlySet<string>,
): LogicDocument {
	const members = document.nodes.filter((node) => ids.has(node.id));
	const laneId = members[0]?.laneId;
	const regionId = members[0]?.regionId ?? ROOT_LAYOUT_REGION_ID;
	const rootLaneMismatch = members.some(
		(member) => member.groupId === undefined && member.laneId !== laneId,
	);
	if (hasLanePresentation(document, regionId) && rootLaneMismatch)
		throw new Error('Les nœuds doivent appartenir à la même voie.');
	const laneFields: { laneId?: string } = {};
	if (hasLanePresentation(document, regionId) && laneId !== undefined) laneFields.laneId = laneId;
	const rootMembers = members.filter((member) => member.groupId === undefined);
	const rootRegionMismatch = rootMembers.some(
		(member) => (member.regionId ?? ROOT_LAYOUT_REGION_ID) !== regionId,
	);
	const regionFormat = hasRegionPresentation(document);
	if (regionFormat && rootRegionMismatch)
		throw new Error('Les nœuds doivent appartenir à la même région.');
	const regionFields: { regionId?: string } = {};
	if (regionFormat && regionId !== ROOT_LAYOUT_REGION_ID) regionFields.regionId = regionId;
	return placeJunctions({
		...document,
		groups: [
			...document.groups,
			{
				...group,
				kind: EndpointKind.Group,
				layoutOrder: fractionalOrderKeySpace.keyFor({}, group.id),
				...laneFields,
				...regionFields,
			},
		],
		nodes: document.nodes.map((node) => {
			if (ids.has(node.id)) {
				const member = { ...node, groupId: group.id };
				delete member.laneId;
				delete member.regionId;
				return member;
			}
			return node;
		}),
	});
}

interface Containable {
	readonly id: string;
	groupId?: string;
	laneId?: string;
	regionId?: string;
}

/** The lane and region a member of `groupId` returns to when it leaves for the root. */
function containerOwnership(
	document: LogicDocument,
	groupId: string,
): { laneId?: string; regionId?: string } {
	if (hasRegionPresentation(document)) {
		const assignments = new Map<string, string>();
		for (const endpoint of [...document.groups, ...document.nodes, ...document.junctions])
			if (endpoint.regionId !== undefined) assignments.set(endpoint.id, endpoint.regionId);
		const normalized = normalizeRegionPresentation(
			document,
			document.regionPresentation?.regions ?? [],
			assignments,
		);
		if (normalized.status !== RegionPresentationStatus.Ready)
			throw new Error('La présentation des régions est invalide.');
		const result: { laneId?: string; regionId?: string } = {};
		const laneId = normalized.value.laneByEndpointId.get(groupId);
		const regionId = normalized.value.regionByEndpointId.get(groupId);
		if (laneId !== undefined) result.laneId = laneId;
		if (regionId !== undefined && regionId !== ROOT_LAYOUT_REGION_ID) result.regionId = regionId;
		return result;
	}
	if (document.presentation === undefined) return {};
	const laneId = normalizeRootLayout(document).laneByEndpointId.get(groupId);
	if (laneId === undefined) return {};
	return { laneId };
}

/**
 * Moves nodes and groups into `groupId`, or to the root when it is `undefined`; a junction is
 * never moved on its own and follows its targets instead. Members inherit their container's lane
 * and region; an element leaving for the root takes the lane and region of the group it leaves.
 * A group never moves into itself or a descendant.
 */
export function moveDocumentElements(
	document: LogicDocument,
	ids: ReadonlySet<string>,
	groupId: string | undefined,
): LogicDocument {
	if (groupId !== undefined) {
		defined(
			document.groups.find((group) => group.id === groupId),
			'Groupe introuvable.',
		);
		const visited = new Set<string>();
		for (let ancestor: string | undefined = groupId; ancestor !== undefined;) {
			if (ids.has(ancestor)) throw new Error('Un groupe ne peut pas entrer dans lui-même.');
			if (visited.has(ancestor)) break;
			visited.add(ancestor);
			ancestor = document.groups.find((group) => group.id === ancestor)?.groupId;
		}
	}
	const ownerships = new Map<string, { laneId?: string; regionId?: string }>();
	const move = <T extends Containable>(item: T): T => {
		if (!ids.has(item.id) || item.groupId === groupId) return item;
		const result = { ...item };
		delete result.groupId;
		delete result.laneId;
		delete result.regionId;
		if (groupId !== undefined) return { ...result, groupId };
		const left = defined(item.groupId);
		let ownership = ownerships.get(left);
		if (ownership === undefined) {
			ownership = containerOwnership(document, left);
			ownerships.set(left, ownership);
		}
		return { ...result, ...ownership };
	};
	return placeJunctions({
		...document,
		groups: document.groups.map(move),
		nodes: document.nodes.map(move),
	});
}

export function dissolveDocumentGroup(document: LogicDocument, id: string): LogicDocument {
	const group = defined(
		document.groups.find((item) => item.id === id),
		'Groupe introuvable.',
	);
	const ungroup = <T extends { groupId?: string; laneId?: string; regionId?: string }>(
		item: T,
	): T => {
		if (item.groupId !== id) return item;
		const result = { ...item };
		delete result.groupId;
		if (group.groupId !== undefined) result.groupId = group.groupId;
		else if (group.laneId !== undefined) result.laneId = group.laneId;
		if (group.groupId === undefined && group.regionId !== undefined)
			result.regionId = group.regionId;
		return result;
	};
	return {
		...document,
		groups: document.groups.filter((item) => item.id !== id).map(ungroup),
		nodes: document.nodes.map(ungroup),
		junctions: document.junctions.map(ungroup),
		relations: document.relations.filter((item) => item.from !== id && item.to !== id),
	};
}
