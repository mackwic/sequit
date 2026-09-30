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
	return {
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
	};
}

export function changeDocumentMembership(
	document: LogicDocument,
	groupId: string,
	ids: ReadonlySet<string>,
	add: boolean,
): LogicDocument {
	defined(
		document.groups.find(({ id }) => id === groupId),
		'Groupe introuvable.',
	);
	let laneId: string | undefined;
	let regionId: string | undefined;
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
		regionId = normalized.value.regionByEndpointId.get(groupId);
		laneId = normalized.value.laneByEndpointId.get(groupId);
	} else if (document.presentation !== undefined)
		laneId = normalizeRootLayout(document).laneByEndpointId.get(groupId);
	return {
		...document,
		nodes: document.nodes.map((node) => {
			if (!ids.has(node.id)) return node;
			if (add) {
				const result = { ...node, groupId };
				delete result.laneId;
				delete result.regionId;
				return result;
			}
			if (node.groupId !== groupId) return node;
			const result = { ...node };
			delete result.groupId;
			if (laneId !== undefined) result.laneId = laneId;
			if (regionId !== undefined && regionId !== ROOT_LAYOUT_REGION_ID) result.regionId = regionId;
			return result;
		}),
	};
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
