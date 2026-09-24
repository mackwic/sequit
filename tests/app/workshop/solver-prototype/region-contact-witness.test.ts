import { describe, expect, it } from 'vitest';

import {
	RegionContactCaseId,
	RegionContactPanelStatus,
	requireRejectedRegionContactCandidate,
	runRegionContactWitnesses,
	solveRegionContactScenario,
} from '../../../../src/app/workshop/visual-tests/solver-prototype/region-contact-witness';
import { defined } from '../../../../src/lib/core/document/logic-document';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';

describe('observable contacts at region boundaries', () => {
	const cases = runRegionContactWitnesses();

	it('keeps a real validated layout beside every falsified geometry in the same frame', () => {
		expect(cases.map(({ id }) => id)).toEqual([
			RegionContactCaseId.Parent,
			RegionContactCaseId.Grid,
		]);
		for (const witness of cases) {
			const validated = defined(witness.panels.find(({ id }) => id === 'validated'));
			const focus = witness.focusViewBox.split(' ').map(Number);
			expect(focus).toHaveLength(4);
			expect(defined(focus[2])).toBeLessThan(witness.width);
			expect(validated.status).toBe(RegionContactPanelStatus.Validated);
			expect(validated.reason).toBeUndefined();
			for (const panel of witness.panels) {
				expect(panel.selected.layout.width).toBe(witness.width);
				expect(panel.selected.layout.height).toBe(witness.height);
				expect(panel.selected.regions).toHaveLength(validated.selected.regions.length);
				if (panel.status === RegionContactPanelStatus.Rejected)
					expect(panel.reason?.length).toBeGreaterThan(0);
			}
		}
	});

	it('shows the parent T contact that separate real portals resolve', () => {
		const witness = defined(cases.find(({ id }) => id === RegionContactCaseId.Parent));
		const validated = defined(witness.panels.find(({ id }) => id === 'validated'));
		const shared = defined(witness.panels.find(({ id }) => id === 'shared-portal'));
		const incoming = defined(
			validated.selected.portals.find(
				({ relationId, regionId }) => relationId === 'inside-branch' && regionId === 'branch-right',
			),
		);
		const outgoing = defined(
			validated.selected.portals.find(
				({ relationId, regionId }) => relationId === 'c-to-d' && regionId === 'branch-right',
			),
		);
		expect(incoming.point.x).toBeLessThan(outgoing.point.x);
		expect(
			shared.selected.portals.find(
				({ relationId, regionId }) => relationId === 'c-to-d' && regionId === 'branch-right',
			)?.point,
		).toEqual(incoming.point);
		expect(shared.status).toBe(RegionContactPanelStatus.Rejected);
		expect(shared.reason).toContain('intersect without a bridge');
	});

	it('shows a local obstacle and a strict hypothetical crossing without claiming a bridge', () => {
		const witness = defined(cases.find(({ id }) => id === RegionContactCaseId.Grid));
		const validated = defined(witness.panels.find(({ id }) => id === 'validated'));
		const direct = defined(witness.panels.find(({ id }) => id === 'direct-exit'));
		const probePanel = defined(witness.panels.find(({ id }) => id === 'strict-crossing'));
		const portal = defined(
			validated.selected.portals.find(
				({ relationId, regionId }) => relationId === 'leaves-grid' && regionId === 'a',
			),
		);
		const directPortal = defined(
			direct.selected.portals.find(
				({ relationId, regionId }) => relationId === 'leaves-grid' && regionId === 'a',
			),
		);
		expect(directPortal.point.x).toBeGreaterThan(portal.point.x);
		expect(direct.reason).toContain('crosses foreign node a-source');
		const probe = defined(probePanel.probe);
		const first = defined(probe.points[0]);
		const last = defined(probe.points.at(-1));
		expect(first.x).toBeLessThan(probe.crossing.x);
		expect(last.x).toBeGreaterThan(probe.crossing.x);
		expect(first.y).toBe(probe.crossing.y);
		expect(last.y).toBe(probe.crossing.y);
		const incident = defined(
			validated.selected.ownedRoutes.find(
				({ relationId, regionId }) => relationId === 'leaves-grid' && regionId === 'a',
			),
		);
		const bend = defined(incident.points.at(-2));
		const boundary = defined(incident.points.at(-1));
		expect(probe.crossing.x).toBe(boundary.x);
		expect(probe.crossing.y).toBeGreaterThan(bend.y);
		expect(probe.crossing.y).toBeLessThan(boundary.y);
		expect(probePanel.status).toBe(RegionContactPanelStatus.Rejected);
		expect(probePanel.validator).toContain('sonde géométrique');
		expect(probePanel.description).toContain('Aucun pont');
	});

	it('reports invalid graph and region ownership from mutations of a real workshop document', () => {
		const source = defined(cases.find(({ id }) => id === RegionContactCaseId.Parent)).source;
		const dangling = {
			...source,
			document: {
				...source.document,
				relations: [...source.document.relations, { id: 'dangling', from: 'c', to: 'missing' }],
			},
		};
		expect(() => solveRegionContactScenario(dangling)).toThrow(
			'The contact witness source graph is invalid.',
		);
		const unknownLeaf = {
			...source,
			input: {
				...source.input,
				regionByEndpointId: new Map([...source.input.regionByEndpointId, ['c', 'missing']]),
			},
		};
		expect(() => solveRegionContactScenario(unknownLeaf)).toThrow(
			'Endpoint c refers to unknown region missing.',
		);
	});

	it('reports a normalized but unsupported crossing capacity instead of publishing a layout', () => {
		const source = defined(cases.find(({ id }) => id === RegionContactCaseId.Parent)).source;
		const tooManyCrossings = {
			...source,
			document: {
				...source.document,
				relations: [
					...source.document.relations,
					{ id: 'root-2', from: 'd', to: 'e' },
					{ id: 'root-3', from: 'd', to: 'e' },
					{ id: 'root-4', from: 'd', to: 'e' },
				],
			},
		};
		expect(() => solveRegionContactScenario(tooManyCrossings)).toThrow(
			'at most three owned crossings',
		);
	});

	it('never labels an accepted geometry as a rejected portal candidate', () => {
		const source = defined(cases.find(({ id }) => id === RegionContactCaseId.Parent)).source;
		const { model, selected } = solveRegionContactScenario(source);
		expect(validateRegionCompositionGeometry(model, selected)).toBeUndefined();
		expect(() =>
			requireRejectedRegionContactCandidate({
				model,
				selected,
				id: 'accidentally-accepted',
				title: 'Accepted geometry',
				description: 'A true baseline may not be presented as rejected.',
			}),
		).toThrow('unexpectedly accepted');
	});

	it('rejects missing local translation from a real selected grid layout', () => {
		const witness = defined(cases.find(({ id }) => id === RegionContactCaseId.Grid));
		const { model, selected } = solveRegionContactScenario(witness.source);
		const missingTranslation = {
			...selected,
			regions: selected.regions.map((region) => {
				if (region.id !== 'a') return region;
				return { id: region.id, parentId: region.parentId, bounds: region.bounds };
			}),
		};
		expect(validateRegionCompositionGeometry(model, missingTranslation)).toContain(
			'has no local layout or translation',
		);
	});
});
