import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { gridDocument, gridInput, prepareGrid } from './grid-cell-fixture';

function digest(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('bounded grid LayoutResult identity', () => {
	it('matches five reference layouts from the original grid solver', () => {
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
		expect(hashes).toEqual({
			base: '56c8759cf1eb73dbe8f016cb610e37a4ff2e0f5ea1e437419789e7528ae473c4',
			'same-column': '6f21fc83aee4537f1de1d6f421a3bce94b09a66ecf256af426792adec64d91b9',
			// Three crossings occupy the left gutter; only two reach the right gutter.
			// Its reserved width falls by 24px, while the bus-free bottom margin falls by 48px.
			'multiple-crossings': 'a4acab99dba7f47cc0deb83b8465c76bfcad2916339ed3dba607e5c587bbdb9c',
			'widened-group': 'e6f40b540c2a0b6d3e782039b2024263171a7023a1dd35ffbb41f3b42274b34d',
			'expanded-tracks': '18d8b6c5333b15b1082fc3761ae01bb2830f11633f413af9521526cbb53afe48',
		});
	});
});
