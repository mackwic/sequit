import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import type { Point } from '../../../../src/lib/core/layout/layout-types';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	NestedRegionLayoutStatus,
	type NestedRegionSelected,
} from '../../../../src/lib/core/layout/nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { validateParentRouteContacts } from '../../../../src/lib/core/layout/region-composition-validation-detail';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

function selected() {
	const prepared = prepareLayoutDocument(depthTwoRegionDocument());
	const input = depthTwoRegionInput();
	const candidate = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	if (candidate.status !== NestedRegionLayoutStatus.Selected)
		throw new Error(`Expected recursive candidate: ${candidate.status}: ${candidate.reason}`);
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	return { graph: prepared.graph, input, candidate, model: normalized.model };
}

const crossingId = 'grandchild-to-right';

function selectedIncident() {
	const source = depthTwoRegionDocument();
	const document = {
		...source,
		relations: [
			defined(source.relations.find(({ id }) => id === 'inside-a')),
			{ id: crossingId, from: 'c', to: 'd' },
		],
	};
	const prepared = prepareLayoutDocument(document);
	const input = depthTwoRegionInput();
	const candidate = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	if (candidate.status !== NestedRegionLayoutStatus.Selected)
		throw new Error(
			`Expected intermediate-boundary candidate: ${candidate.status}: ${candidate.reason}`,
		);
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	return { graph: prepared.graph, input, candidate, model: normalized.model };
}

function restitchIncident(candidate: NestedRegionSelected): NestedRegionSelected {
	const owners = candidate.ownedRoutes.filter(({ relationId }) => relationId === crossingId);
	const points: Point[] = [];
	for (const owner of owners) {
		if (points.length === 0) points.push(...owner.points);
		else points.push(...owner.points.slice(1));
	}
	return {
		...candidate,
		layout: {
			...candidate.layout,
			relations: candidate.layout.relations.map((relation) => {
				if (relation.id !== crossingId) return relation;
				return { ...relation, points };
			}),
		},
	};
}

function changedIncidentPiece(
	candidate: NestedRegionSelected,
	regionId: string,
	points: readonly Point[],
): NestedRegionSelected {
	return restitchIncident({
		...candidate,
		ownedRoutes: candidate.ownedRoutes.map((piece) => {
			if (piece.relationId !== crossingId || piece.regionId !== regionId) return piece;
			return { ...piece, points };
		}),
	});
}

function changedRegion(
	candidate: NestedRegionSelected,
	id: string,
	change: (
		region: NestedRegionSelected['regions'][number],
	) => NestedRegionSelected['regions'][number],
): NestedRegionSelected {
	return {
		...candidate,
		regions: candidate.regions.map((region) => {
			if (region.id !== id) return region;
			return change(region);
		}),
	};
}

describe('recursive region geometry validator', () => {
	it('rejects a missing descendant frame', () => {
		const { model, candidate } = selected();
		const missing = {
			...candidate,
			regions: candidate.regions.filter(({ id }) => id !== 'middle'),
		};
		expect(validateRegionCompositionGeometry(model, missing)).toContain('each child region');
	});

	it('rejects a repeated descendant frame identity', () => {
		const { model, candidate } = selected();
		const repeated = changedRegion(candidate, 'branch-right', (region) => ({
			...region,
			id: 'middle',
		}));
		expect(validateRegionCompositionGeometry(model, repeated)).toContain('repeats');
	});

	it('rejects an unrecognized descendant frame', () => {
		const { model, candidate } = selected();
		const foreign = changedRegion(candidate, 'branch-right', (region) => ({
			...region,
			id: 'foreign',
		}));
		expect(validateRegionCompositionGeometry(model, foreign)).toContain('not in the region model');
	});

	it('rejects a top-level frame attached to the wrong parent', () => {
		const { model, candidate } = selected();
		const wrong = changedRegion(candidate, 'branch', (region) => ({
			...region,
			parentId: 'right',
		}));
		expect(validateRegionCompositionGeometry(model, wrong)).toContain('wrong parent');
	});

	it('rejects a grandchild frame attached to a foreign parent', () => {
		const { model, candidate } = selected();
		const wrong = changedRegion(candidate, 'middle', (region) => ({
			...region,
			parentId: 'right',
		}));
		expect(validateRegionCompositionGeometry(model, wrong)).toBeDefined();
	});

	it('rejects a grandchild that escapes its local parent canvas', () => {
		const { model, candidate } = selected();
		const escaped = changedRegion(candidate, 'middle', (region) => ({
			...region,
			bounds: { ...region.bounds, x: region.bounds.x + 10_000 },
		}));
		expect(validateRegionCompositionGeometry(model, escaped)).toContain('outside');
	});

	it('rejects an incident portal moved off its grandchild boundary', () => {
		const { model, candidate } = selected();
		const misplaced = {
			...candidate,
			portals: candidate.portals.map((portal) => {
				if (portal.relationId !== 'inside-branch' || portal.endpointId !== 'a-target')
					return portal;
				return { ...portal, point: { ...portal.point, y: portal.point.y + 1 } };
			}),
		};
		expect(validateRegionCompositionGeometry(model, misplaced)).toContain('portal');
	});

	it('rejects a grandchild route falsely owned by the virtual root', () => {
		const { model, candidate } = selected();
		const misplaced = {
			...candidate,
			ownedRoutes: candidate.ownedRoutes.map((piece) => {
				if (piece.relationId !== 'inside-branch' || piece.regionId !== 'branch') return piece;
				return { ...piece, regionId: '@root' };
			}),
		};
		expect(validateRegionCompositionGeometry(model, misplaced)).toContain('wrong boundary owner');
	});

	it('rejects a missing root-owned relation route', () => {
		const { model, candidate } = selected();
		const missing = {
			...candidate,
			ownedRoutes: candidate.ownedRoutes.filter(({ relationId }) => relationId !== 'at-root'),
		};
		expect(validateRegionCompositionGeometry(model, missing)).toContain(
			'missing or extra owned piece',
		);
	});

	it('rejects a missing relation in the composed root canvas', () => {
		const { model, candidate } = selected();
		const missing = {
			...candidate,
			layout: {
				...candidate.layout,
				relations: candidate.layout.relations.filter(({ id }) => id !== 'inside-branch'),
			},
		};
		expect(validateRegionCompositionGeometry(model, missing)).toContain(
			'does not contain each relation exactly once',
		);
	});

	it('rejects a malformed hierarchy before final validation', () => {
		const { graph, input } = selected();
		const malformed = {
			...input,
			regions: [...input.regions, { id: 'left', parentId: 'branch', layoutOrder: 'z' }],
		};
		expect(normalizeRegionCompositionModel(graph, malformed)).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: { code: RegionCompositionDiagnosticCode.DuplicateRegionId },
		});
	});

	it('rejects an intermediate relation missing from the composed canvas', () => {
		const { candidate, model } = selectedIncident();
		const missing = {
			...candidate,
			layout: {
				...candidate.layout,
				relations: candidate.layout.relations.filter(({ id }) => id !== crossingId),
			},
		};
		expect(validateRegionCompositionGeometry(model, missing)).toContain(
			'does not contain each relation exactly once',
		);
	});

	it('rejects a composed route that differs from its owned boundary pieces', () => {
		const { candidate, model } = selectedIncident();
		const changed = {
			...candidate,
			layout: {
				...candidate.layout,
				relations: candidate.layout.relations.map((relation) => {
					if (relation.id !== crossingId) return relation;
					return { ...relation, points: [...relation.points, defined(relation.points.at(-1))] };
				}),
			},
		};
		expect(validateRegionCompositionGeometry(model, changed)).toContain(
			'differs from its owned pieces',
		);
	});

	it('rejects a false owner and a non-orthogonal intermediate piece', () => {
		const { candidate, model } = selectedIncident();
		const wrongOwner = {
			...candidate,
			ownedRoutes: candidate.ownedRoutes.map((piece) => {
				if (piece.relationId !== crossingId || piece.regionId !== 'branch') return piece;
				return { ...piece, regionId: '@root' };
			}),
		};
		expect(validateRegionCompositionGeometry(model, wrongOwner)).toContain('wrong boundary owner');
		const leaf = defined(
			candidate.ownedRoutes.find(
				({ relationId, regionId }) => relationId === crossingId && regionId === 'branch-right',
			),
		);
		const first = defined(leaf.points[0]);
		const last = defined(leaf.points.at(-1));
		const diagonal = {
			...candidate,
			ownedRoutes: candidate.ownedRoutes.map((piece) => {
				if (piece.relationId !== crossingId || piece.regionId !== 'branch-right') return piece;
				return { ...piece, points: [first, { x: first.x + 1, y: first.y + 1 }, last] };
			}),
		};
		expect(validateRegionCompositionGeometry(model, diagonal)).toContain(
			'non-orthogonal owned piece',
		);
	});

	it('rejects a parent-owned corridor outside its frame or through an opaque grandchild', () => {
		const { candidate, model } = selectedIncident();
		const parent = defined(
			candidate.ownedRoutes.find(
				({ relationId, regionId }) => relationId === crossingId && regionId === 'branch',
			),
		);
		const branch = defined(candidate.regions.find(({ id }) => id === 'branch'));
		const middle = defined(candidate.regions.find(({ id }) => id === 'middle'));
		const first = defined(parent.points[0]);
		const last = defined(parent.points.at(-1));
		const outsideX = branch.bounds.x + branch.bounds.width + 1;
		const escaped = changedIncidentPiece(candidate, 'branch', [
			first,
			{ x: outsideX, y: first.y },
			{ x: outsideX, y: last.y },
			last,
		]);
		expect(validateRegionCompositionGeometry(model, escaped)).toContain(
			'leaves its owning region branch',
		);
		const middleY = middle.bounds.y + middle.bounds.height / 2;
		const middleX = middle.bounds.x + middle.bounds.width / 2;
		const opaque = changedIncidentPiece(candidate, 'branch', [
			first,
			{ x: first.x, y: middleY },
			{ x: middleX, y: middleY },
			{ x: last.x, y: middleY },
			last,
		]);
		expect(validateRegionCompositionGeometry(model, opaque)).toContain(
			'enters opaque child middle from owner branch',
		);
	});

	it('rejects malformed and disconnected intermediate portals', () => {
		const { candidate, model } = selectedIncident();
		const branch = defined(candidate.regions.find(({ id }) => id === 'branch'));
		const original = defined(
			candidate.portals.find(
				({ relationId, regionId }) => relationId === crossingId && regionId === 'branch',
			),
		);
		const variants = [
			{ name: 'wrong region', change: { regionId: 'middle' } },
			{ name: 'wrong endpoint', change: { endpointId: 'd' } },
			{
				name: 'left boundary edge',
				change: {
					point: { ...original.point, x: branch.bounds.x },
					localPoint: { ...original.localPoint, x: 0 },
				},
			},
			{
				name: 'right boundary edge',
				change: {
					point: { ...original.point, x: branch.bounds.x + branch.bounds.width },
					localPoint: { ...original.localPoint, x: branch.bounds.width },
				},
			},
			{
				name: 'wrong boundary height',
				change: { point: { ...original.point, y: original.point.y + 1 } },
			},
			{
				name: 'wrong local x',
				change: { localPoint: { ...original.localPoint, x: original.localPoint.x + 1 } },
			},
			{
				name: 'wrong local y',
				change: { localPoint: { ...original.localPoint, y: original.localPoint.y + 1 } },
			},
		];
		for (const variant of variants) {
			const falsified = {
				...candidate,
				portals: candidate.portals.map((portal) => {
					if (portal !== original) return portal;
					return { ...portal, ...variant.change };
				}),
			};
			expect(validateRegionCompositionGeometry(model, falsified), variant.name).toContain(
				'invalid boundary portal',
			);
		}
		const disconnected = {
			...candidate,
			portals: candidate.portals.map((portal) => {
				if (portal !== original) return portal;
				return {
					...portal,
					point: { ...portal.point, x: portal.point.x + 1 },
					localPoint: { ...portal.localPoint, x: portal.localPoint.x + 1 },
				};
			}),
		};
		expect(validateRegionCompositionGeometry(model, disconnected)).toContain(
			'disconnected boundary portal',
		);
	});

	it('rejects an owned piece referring to an unknown relation', () => {
		const { candidate, model } = selectedIncident();
		const parent = defined(
			candidate.ownedRoutes.find(
				({ relationId, regionId }) => relationId === crossingId && regionId === 'branch',
			),
		);
		const foreign = {
			...candidate,
			ownedRoutes: [...candidate.ownedRoutes, { ...parent, relationId: 'foreign-route' }],
		};
		expect(validateRegionCompositionGeometry(model, foreign)).toContain('unknown relation');
	});

	it('rejects colliding parent corridors without a bridge', () => {
		const { candidate, model } = selectedIncident();
		const parent = defined(
			candidate.ownedRoutes.find(
				({ relationId, regionId }) => relationId === crossingId && regionId === 'branch',
			),
		);
		const overlapping = [...candidate.ownedRoutes, { ...parent, relationId: 'foreign-route' }];
		expect(validateParentRouteContacts(model, overlapping)).toContain('intersect without a bridge');
	});
});
