import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import { defined } from '../../../../src/lib/core/document/logic-document';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { gridDocument, gridInput, prepareGrid } from './grid-cell-fixture';

function digest(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('bounded grid LayoutResult identity', () => {
	it('pins five grid layout identities with canonical public relation order', () => {
		const base = prepareGrid();
		const source = gridDocument();
		const sameColumn = prepareGrid({
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id === 'across-grid') return { ...relation, to: 'c' };
				return relation;
			}),
		});
		const multipleCrossings = prepareGrid({
			...source,
			relations: [
				...source.relations,
				{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
				{ id: 'third-crossing', from: 'a-top', to: 'd' },
			],
		});
		const group = defined(base.measurements.groups.get('oversized'));
		const widenedGroup = {
			...base,
			measurements: {
				...base.measurements,
				groups: new Map(base.measurements.groups).set('oversized', {
					...group,
					minimumWidth: group.minimumWidth + 160,
				}),
			},
		};
		const input = gridInput();
		const cases = [
			{ name: 'base', prepared: base, input },
			{ name: 'same-column', prepared: sameColumn, input },
			{ name: 'multiple-crossings', prepared: multipleCrossings, input },
			{ name: 'widened-group', prepared: widenedGroup, input },
			{
				name: 'expanded-tracks',
				prepared: base,
				input: {
					...input,
					minimumColumnWidths: [900, 700] as const,
					minimumRowHeights: [600, 420] as const,
				},
			},
		];
		const hashes = Object.fromEntries(
			cases.map(({ name, prepared, input: selectedInput }) => {
				const result = solveGridCellLayout(prepared.graph, prepared.measurements, selectedInput);
				if (result.status !== GridCellLayoutStatus.Selected)
					throw new Error(`${name}: ${result.reason}`);
				return [name, digest(result.layout)];
			}),
		);
		// base, widened-group and expanded-tracks keep main's layouts. same-column now crosses the
		// row gap straight from a-top's bottom face to c's top face (G-02). In multiple crossings, the
		// gap route of second-crossing would cross third-crossing or across-grid without a bridge in
		// every allocation tried, so the gutter allocation stays: row-routed across-grid takes the
		// innermost left track and third-crossing, over the top bus, the outermost one and the bus
		// track nearest the grid.
		expect(hashes).toEqual({
			base: '56c8759cf1eb73dbe8f016cb610e37a4ff2e0f5ea1e437419789e7528ae473c4',
			'same-column': '6f882edf7465d0bf1552b0a04a220f24e9d634ab30d3755bace54408ccf49edb',
			'multiple-crossings': 'c4a5f7d5dee356d5c21b785355a47f5099737a1a8385556813211d257e55ae2b',
			'widened-group': 'e6f40b540c2a0b6d3e782039b2024263171a7023a1dd35ffbb41f3b42274b34d',
			'expanded-tracks': '18d8b6c5333b15b1082fc3761ae01bb2830f11633f413af9521526cbb53afe48',
		});
	});

	it('keeps every grid route geometry when relation ids are permuted', () => {
		const source = gridDocument();
		const relations = [
			...source.relations,
			{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
			{ id: 'third-crossing', from: 'a-top', to: 'd' },
		];
		const renamedIds = ['z-inside-a', 'y-across-grid', 'x-second-crossing', 'a-third-crossing'];
		const originalIdByRenamed = new Map(
			relations.map(({ id }, index) => [defined(renamedIds[index]), id]),
		);
		const originalDocument = { ...source, relations };
		const renamedDocument = {
			...source,
			relations: relations.map((relation, index) => ({
				...relation,
				id: defined(renamedIds[index]),
			})),
		};
		const solve = (
			document: typeof originalDocument,
			originalIdFor: ReadonlyMap<string, string>,
		) => {
			const prepared = prepareGrid(document);
			const attempt = solveGridCellLayout(prepared.graph, prepared.measurements, gridInput());
			if (attempt.status !== GridCellLayoutStatus.Selected)
				throw new Error(`Expected a selected grid: ${attempt.reason}`);
			return {
				...attempt.layout,
				relations: [...attempt.layout.relations]
					.map((relation) => ({
						...relation,
						id: originalIdFor.get(relation.id) ?? relation.id,
					}))
					.sort((left, right) => compareCanonicalStrings(left.id, right.id)),
			};
		};
		const identity = new Map(relations.map(({ id }) => [id, id]));
		expect(solve(renamedDocument, originalIdByRenamed)).toEqual(solve(originalDocument, identity));
	});

	it('returns selected relation routes and portals sorted by relation id', () => {
		const source = gridDocument();
		const relations = [
			...source.relations,
			{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
			{ id: 'third-crossing', from: 'a-top', to: 'd' },
		];
		const prepared = prepareGrid({ ...source, relations });
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, gridInput());
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error(`Expected a selected grid: ${result.reason}`);
		expect(result.layout.relations.map(({ id }) => id)).toEqual(
			relations.map(({ id }) => id).toSorted(compareCanonicalStrings),
		);
		expect(result.portals.map(({ relationId }) => relationId)).toEqual(
			[
				'across-grid',
				'across-grid',
				'second-crossing',
				'second-crossing',
				'third-crossing',
				'third-crossing',
			].toSorted(compareCanonicalStrings),
		);
	});
});
