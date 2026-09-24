import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grid-cell-types';
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
			base: '66351cf75a9380db7fe7733ca89613cc93193f7d6c714a1a406b26a98e9f3803',
			'same-column': '6f21fc83aee4537f1de1d6f421a3bce94b09a66ecf256af426792adec64d91b9',
			'multiple-crossings': 'f73aa8b512f12d732ad8cefeb9c6a90114a906c5b3ff1085e43f42dfd526d374',
			'widened-group': '44b79dfd0361fbe6c805edd0a296327fb79d80f87f940e3ae2f4e62373da615f',
			'expanded-tracks': 'fa052566dabc5cace7cb70174adf5b2d11740c43bfe313d62d8363bdbc5a07f9',
		});
	});
});
