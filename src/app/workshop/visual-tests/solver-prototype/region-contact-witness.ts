import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicNode,
	PERSISTENCE_FORMAT,
} from '../../../../lib/core/document/logic-document';
import { orderKey } from '../../../../lib/core/document/order-key';
import { createGraph } from '../../../../lib/core/graph/create-graph';
import type { LayoutMeasurements, Point } from '../../../../lib/core/layout/layout-types';
import {
	normalizeRegionCompositionModel,
	type RegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutAttempt,
	type RegionLayoutSelected,
	type RegionOwnedRoute,
} from '../../../../lib/core/layout/regions/model/region-composition-types';
import { solveRecursiveNestedRegionLayout } from '../../../../lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../lib/core/layout/regions/validation/region-composition-validation';

export enum RegionContactCaseId {
	Parent = 'parent-contact',
	Grid = 'grid-contact',
}

export enum RegionContactPanelStatus {
	Validated = 'validated',
	Rejected = 'rejected',
}

interface RegionContactProbe {
	readonly points: readonly Point[];
	readonly crossing: Point;
}

interface RegionContactPanel {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly status: RegionContactPanelStatus;
	readonly validator: string;
	readonly reason: string | undefined;
	readonly selected: RegionLayoutSelected;
	readonly probe?: RegionContactProbe;
}

export interface RegionContactCase {
	readonly id: RegionContactCaseId;
	readonly title: string;
	readonly description: string;
	readonly source: RegionContactSource;
	readonly width: number;
	readonly height: number;
	readonly focusViewBox: string;
	readonly panels: readonly RegionContactPanel[];
}

interface SolvedContact {
	readonly selected: RegionLayoutSelected;
	readonly model: RegionCompositionModel;
}

interface RegionContactSource {
	readonly document: LogicDocument;
	readonly input: RegionInput;
}

function node(id: string, order: string): LogicNode {
	return {
		kind: EndpointKind.Node,
		id,
		natureId: 'task',
		markdown: `${id}\n`,
		layoutOrder: orderKey(order),
	};
}

function baseDocument(): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'region-contact-witness',
		title: 'Contacts aux frontières',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes: [node('a-source', 'a0'), node('a-target', 'a1'), node('b', 'a2'), node('c', 'a3')],
		relations: [{ id: 'inside-a', from: 'a-source', to: 'a-target' }],
	};
}

function branchSource(): { readonly document: LogicDocument; readonly input: RegionInput } {
	const source = baseDocument();
	return {
		document: {
			...source,
			id: 'parent-contact-witness',
			nodes: [...source.nodes, node('d', 'a4'), node('e', 'a5')],
			relations: [
				...source.relations,
				{ id: 'inside-branch', from: 'a-target', to: 'c' },
				{ id: 'c-to-d', from: 'c', to: 'd' },
			],
		},
		input: {
			regions: [
				{ id: '@root', layoutOrder: '0' },
				{ id: 'branch', parentId: '@root', layoutOrder: 'a' },
				{ id: 'right', parentId: '@root', layoutOrder: 'b' },
				{ id: 'far-right', parentId: '@root', layoutOrder: 'c' },
				{ id: 'left', parentId: 'branch', layoutOrder: 'a' },
				{ id: 'middle', parentId: 'branch', layoutOrder: 'b' },
				{ id: 'branch-right', parentId: 'branch', layoutOrder: 'c' },
			],
			regionByEndpointId: new Map([
				['a-source', 'left'],
				['a-target', 'left'],
				['b', 'middle'],
				['c', 'branch-right'],
				['d', 'right'],
				['e', 'far-right'],
			]),
		},
	};
}

function gridSource(): { readonly document: LogicDocument; readonly input: RegionInput } {
	const source = baseDocument();
	return {
		document: {
			...source,
			id: 'grid-contact-witness',
			nodes: [...source.nodes, node('d', 'a4'), node('outside', 'a5')],
			relations: [...source.relations, { id: 'leaves-grid', from: 'a-target', to: 'outside' }],
		},
		input: {
			regions: [
				{ id: '@root', layoutOrder: '0' },
				{
					id: 'grid',
					parentId: '@root',
					layoutOrder: 'a',
					grid: {
						minimumColumnWidths: [700, 100],
						minimumRowHeights: [50, 300],
						cells: [
							{ regionId: 'a', row: 0, column: 0 },
							{ regionId: 'b', row: 0, column: 1 },
							{ regionId: 'c', row: 1, column: 0 },
							{ regionId: 'd', row: 1, column: 1 },
						],
					},
				},
				{ id: 'outside', parentId: '@root', layoutOrder: 'b' },
				{ id: 'a', parentId: 'grid', layoutOrder: 'a' },
				{ id: 'b', parentId: 'grid', layoutOrder: 'b' },
				{ id: 'c', parentId: 'grid', layoutOrder: 'c' },
				{ id: 'd', parentId: 'grid', layoutOrder: 'd' },
			],
			regionByEndpointId: new Map([
				['a-source', 'a'],
				['a-target', 'a'],
				['b', 'b'],
				['c', 'c'],
				['d', 'd'],
				['outside', 'outside'],
			]),
		},
	};
}

function measurements(document: LogicDocument): LayoutMeasurements {
	return {
		nodes: new Map(document.nodes.map(({ id }) => [id, { width: 220, height: 116 }])),
		groups: new Map(),
		junctions: new Map(),
	};
}

function boundsCorners(bounds: {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}): readonly Point[] {
	return [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
	];
}

function focusViewBox(points: readonly Point[]): string {
	const xs = points.map(({ x }) => x);
	const ys = points.map(({ y }) => y);
	const left = Math.min(...xs);
	const top = Math.min(...ys);
	const right = Math.max(...xs);
	const bottom = Math.max(...ys);
	const width = Math.max(760, right - left + 160);
	const height = Math.max(480, bottom - top + 160);
	const x = (left + right - width) / 2;
	const y = (top + bottom - height) / 2;
	return `${x} ${y} ${width} ${height}`;
}

/** Inspect the production solver verdict before a workshop panel claims a selected geometry. */
export function probeRegionContactScenario(source: RegionContactSource): {
	readonly model: RegionCompositionModel;
	readonly attempt: RegionLayoutAttempt;
} {
	const graph = createGraph(source.document);
	if (!graph.ok) throw new Error('The contact witness source graph is invalid.');
	const normalized = normalizeRegionCompositionModel(graph.value, source.input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	const attempt = solveRecursiveNestedRegionLayout(
		graph.value,
		measurements(source.document),
		source.input,
	);
	return { model: normalized.model, attempt };
}

/** Runs a selected workshop source through the real solver and independent geometry oracles. */
export function solveRegionContactScenario(source: RegionContactSource): SolvedContact {
	const { model, attempt: selected } = probeRegionContactScenario(source);
	if (selected.status !== RegionCompositionStatus.Selected)
		throw new Error(`The contact witness is ${selected.status}: ${selected.reason}`);
	const failure = validateContact(model, selected);
	if (failure !== undefined) throw new Error(`The real contact witness is invalid: ${failure}`);
	return { model, selected };
}

function validateContact(
	model: RegionCompositionModel,
	selected: RegionLayoutSelected,
): string | undefined {
	return (
		validateRegionCompositionGeometry(model, selected) ??
		validateNestedRegionLeafIncidents(model, selected)
	);
}

function stitched(pieces: readonly RegionOwnedRoute[]): readonly Point[] {
	return pieces.flatMap(({ points }, index) => {
		if (index === 0) return [...points];
		return points.slice(1);
	});
}

function withChangedIncident(
	selected: RegionLayoutSelected,
	relationId: string,
	ownedRoutes: readonly RegionOwnedRoute[],
	portals: RegionLayoutSelected['portals'],
): RegionLayoutSelected {
	const points = stitched(ownedRoutes.filter((piece) => piece.relationId === relationId));
	return {
		...selected,
		ownedRoutes,
		portals,
		layout: {
			...selected.layout,
			relations: selected.layout.relations.map((route) => {
				if (route.id !== relationId) return route;
				return { ...route, points };
			}),
		},
	};
}

function sharedParentPortal(selected: RegionLayoutSelected): RegionLayoutSelected {
	const incoming = defined(
		selected.portals.find(
			({ relationId, regionId }) => relationId === 'inside-branch' && regionId === 'branch-right',
		),
	);
	const outgoing = defined(
		selected.portals.find(
			({ relationId, regionId }) => relationId === 'c-to-d' && regionId === 'branch-right',
		),
	);
	const leafPiece = defined(
		selected.ownedRoutes.find(
			({ relationId, regionId }) => relationId === 'c-to-d' && regionId === 'branch-right',
		),
	);
	const parentPiece = defined(
		selected.ownedRoutes.find(
			({ relationId, regionId }) => relationId === 'c-to-d' && regionId === 'branch',
		),
	);
	const anchor = defined(leafPiece.points[0]);
	const next = defined(parentPiece.points[1]);
	const pieces = selected.ownedRoutes.map((piece) => {
		if (piece === leafPiece)
			return {
				...piece,
				points: [anchor, { x: anchor.x, y: incoming.point.y }, incoming.point],
			};
		if (piece === parentPiece)
			return {
				...piece,
				points: [incoming.point, { x: incoming.point.x, y: next.y }, ...piece.points.slice(1)],
			};
		return piece;
	});
	const portals = selected.portals.map((portal) => {
		if (portal !== outgoing) return portal;
		return { ...portal, point: incoming.point, localPoint: incoming.localPoint };
	});
	return withChangedIncident(selected, 'c-to-d', pieces, portals);
}

function directCellExit(selected: RegionLayoutSelected): RegionLayoutSelected {
	const cell = defined(selected.regions.find(({ id }) => id === 'a'));
	const portal = defined(
		selected.portals.find(
			({ relationId, regionId }) => relationId === 'leaves-grid' && regionId === 'a',
		),
	);
	const cellPiece = defined(
		selected.ownedRoutes.find(
			({ relationId, regionId }) => relationId === 'leaves-grid' && regionId === 'a',
		),
	);
	const gridPiece = defined(
		selected.ownedRoutes.find(
			({ relationId, regionId }) => relationId === 'leaves-grid' && regionId === 'grid',
		),
	);
	const anchor = defined(cellPiece.points[0]);
	const source = defined(selected.layout.elements.find(({ id }) => id === 'a-source'));
	const detourY = source.bounds.y + source.bounds.height / 2;
	const point = { x: source.bounds.x + source.bounds.width + 32, y: portal.point.y };
	const pieces = selected.ownedRoutes.map((piece) => {
		if (piece === cellPiece)
			return {
				...piece,
				points: [anchor, { x: anchor.x, y: detourY }, { x: point.x, y: detourY }, point],
			};
		if (piece === gridPiece)
			return { ...piece, points: [point, portal.point, ...piece.points.slice(1)] };
		return piece;
	});
	const portals = selected.portals.map((item) => {
		if (item !== portal) return item;
		return {
			...item,
			point,
			localPoint: { x: point.x - cell.bounds.x, y: point.y - cell.bounds.y },
		};
	});
	return withChangedIncident(selected, 'leaves-grid', pieces, portals);
}

function selectedPanel(selected: RegionLayoutSelected, description: string): RegionContactPanel {
	return {
		id: 'validated',
		title: 'Corridor distinct',
		description,
		status: RegionContactPanelStatus.Validated,
		validator: 'composition + incidents',
		reason: undefined,
		selected,
	};
}

/** Requires a candidate to fail an independent geometry oracle before labelling it rejected. */
export function requireRejectedRegionContactCandidate(input: {
	readonly model: RegionCompositionModel;
	readonly selected: RegionLayoutSelected;
	readonly id: string;
	readonly title: string;
	readonly description: string;
}): RegionContactPanel {
	const reason = validateContact(input.model, input.selected);
	if (reason === undefined) throw new Error(`The ${input.id} candidate was unexpectedly accepted.`);
	return {
		id: input.id,
		title: input.title,
		description: input.description,
		status: RegionContactPanelStatus.Rejected,
		validator: 'composition + incidents',
		reason,
		selected: input.selected,
	};
}

function strictCrossingProbe(selected: RegionLayoutSelected): RegionContactPanel {
	const cellPiece = defined(
		selected.ownedRoutes.find(
			({ relationId, regionId }) => relationId === 'leaves-grid' && regionId === 'a',
		),
	);
	const bend = defined(cellPiece.points.at(-2));
	const portal = defined(cellPiece.points.at(-1));
	const crossing = { x: portal.x, y: (bend.y + portal.y) / 2 };
	const points = [
		{ x: crossing.x - 18, y: crossing.y },
		{ x: crossing.x + 18, y: crossing.y },
	];
	return {
		id: 'strict-crossing',
		title: 'Croisement strict · hypothèse',
		description:
			'Un tronçon local falsifié coupe le trajet incident en plein segment. Aucun pont n’est matérialisé ni validé.',
		status: RegionContactPanelStatus.Rejected,
		validator: 'sonde géométrique (sans pont)',
		reason: 'Contact intérieur entre deux segments, sans règle de pont.',
		selected,
		probe: { points, crossing },
	};
}

function parentContact(): RegionContactCase {
	const source = branchSource();
	const { model, selected } = solveRegionContactScenario(source);
	const focusPoints = [
		...selected.ownedRoutes
			.filter(({ regionId }) => regionId === 'branch')
			.flatMap(({ points }) => points),
		...selected.portals
			.filter(({ regionId }) => regionId === 'branch-right')
			.map(({ point }) => point),
		...selected.regions
			.filter(({ id }) => id === 'left')
			.flatMap(({ bounds }) => boundsCorners(bounds)),
		...selected.layout.elements
			.filter(({ id }) => id === 'c')
			.flatMap(({ bounds }) => boundsCorners(bounds)),
	];
	return {
		id: RegionContactCaseId.Parent,
		title: 'Deux incidents sur C : bus parent et sortie racine',
		description:
			'La relation de la branche arrive sur C pendant que C sort vers une feuille sœur. Les portails séparés évitent le contact en T.',
		source,
		width: selected.layout.width,
		height: selected.layout.height,
		focusViewBox: focusViewBox(focusPoints),
		panels: [
			selectedPanel(selected, 'Deux portails de la même face sont ordonnés et vérifiés.'),
			requireRejectedRegionContactCandidate({
				model,
				selected: sharedParentPortal(selected),
				id: 'shared-portal',
				title: 'Portail partagé · falsification',
				description:
					'La sortie de C rejoint le portail entrant sans contrat de tronc partagé. Le contact en T est rejeté.',
			}),
		],
	};
}

function gridContact(): RegionContactCase {
	const source = gridSource();
	const { model, selected } = solveRegionContactScenario(source);
	const cell = defined(selected.regions.find(({ id }) => id === 'a'));
	const focusPoints = [
		...boundsCorners(cell.bounds),
		...selected.ownedRoutes
			.filter(({ regionId }) => regionId === 'a')
			.flatMap(({ points }) => points),
	];
	return {
		id: RegionContactCaseId.Grid,
		title: 'Relation locale et sortie d’une cellule de grille',
		description:
			'La paire locale et sortie est sélectionnée. Ajouter la traversée across-grid croise cette sortie : le contact est un croisement strict que l’oracle de pont valide, et la scène reste sélectionnée.',
		source,
		width: selected.layout.width,
		height: selected.layout.height,
		focusViewBox: focusViewBox(focusPoints),
		panels: [
			selectedPanel(selected, 'La route externe contourne a-source et respecte chaque cadre.'),
			requireRejectedRegionContactCandidate({
				model,
				selected: directCellExit(selected),
				id: 'direct-exit',
				title: 'Détour par a-source · falsification',
				description:
					'Un détour ajouté à la sortie traverse le nœud local a-source. Le validateur le rejette.',
			}),
			strictCrossingProbe(selected),
		],
	};
}

/** Runs both bounded production solvers and their independent composition/contact oracles. */
export function runRegionContactWitnesses(): readonly RegionContactCase[] {
	return [parentContact(), gridContact()];
}
