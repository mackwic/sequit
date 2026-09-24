import { describe, expect, it } from 'vitest';

import type { SequitDiagnostic } from '../../../../src/lib/core/document/logic-document';
import { mapPresentation } from '../../../../src/lib/infrastructure/toml/map-layout-presentation';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../support/builders/logic-document';

describe('TOML lane presentation versions', () => {
	it('keeps format 2 implicit and round trips format 3 with lane ownership', () => {
		const legacy = serializeSequitToml(validLogicDocument());
		expect(legacy).toContain('persistenceFormat = 2');
		expect(legacy).not.toContain('[presentation]');
		expect(parseSequitToml(legacy)).toMatchObject({
			ok: true,
			value: { persistenceFormat: 2 },
		});

		const explicit = serializeSequitToml(explicitLaneLogicDocument());
		expect(explicit).toContain('persistenceFormat = 3');
		expect(explicit).toContain('[presentation]');
		expect(explicit).toContain('[presentation.lanes.left]');
		const parsed = parseSequitToml(explicit);
		expect(parsed).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: 3,
				presentation: { policy: 'layered', lanes: [{ id: 'left' }, { id: 'right' }] },
			},
		});
		if (!parsed.ok) throw new Error('Expected explicit lanes to parse');
		expect(serializeSequitToml(parsed.value)).toBe(explicit);
	});

	it('reports malformed presentation tables at their exact field paths', () => {
		const raw = {
			schemaVersion: 1,
			policy: 'layered',
			laneOrientation: 'parallel',
			growth: 'auto',
			lanes: {
				left: { label: 'Left', layoutOrder: 'a0' },
				right: { label: 'Right', layoutOrder: 'a1' },
			},
		};
		const cases: readonly {
			name: string;
			value: unknown;
			path: string;
			withoutPresentation?: boolean;
		}[] = [
			{ name: 'missing root', value: undefined, path: 'presentation', withoutPresentation: true },
			{ name: 'non-table root', value: [], path: 'presentation', withoutPresentation: true },
			{ name: 'unknown root field', value: { ...raw, extra: true }, path: 'presentation.extra' },
			{
				name: 'missing lanes table',
				value: { ...raw, lanes: undefined },
				path: 'presentation.lanes',
			},
			{
				name: 'non-table lane',
				value: { ...raw, lanes: { ...raw.lanes, left: [] } },
				path: 'presentation.lanes.left',
			},
			{
				name: 'unknown lane field',
				value: { ...raw, lanes: { ...raw.lanes, left: { ...raw.lanes.left, extra: true } } },
				path: 'presentation.lanes.left.extra',
			},
			{
				name: 'incomplete lane',
				value: { ...raw, lanes: { ...raw.lanes, left: { layoutOrder: 'a0' } } },
				path: 'presentation.lanes.left.label',
			},
			{
				name: 'unsupported policy',
				value: { ...raw, policy: 'force' },
				path: 'presentation.policy',
				withoutPresentation: true,
			},
			{
				name: 'missing lane orientation',
				value: { ...raw, laneOrientation: undefined },
				path: 'presentation.laneOrientation',
				withoutPresentation: true,
			},
			{
				name: 'unsupported lane orientation',
				value: { ...raw, laneOrientation: 'diagonal' },
				path: 'presentation.laneOrientation',
				withoutPresentation: true,
			},
			{
				name: 'unsupported growth',
				value: { ...raw, growth: 'fixed' },
				path: 'presentation.growth',
				withoutPresentation: true,
			},
		];
		for (const testCase of cases) {
			const diagnostics: SequitDiagnostic[] = [];
			const presentation = mapPresentation(testCase.value, { diagnostics });
			expect(
				diagnostics.map(({ path }) => path.join('.')),
				testCase.name,
			).toContain(testCase.path);
			if (testCase.withoutPresentation === true)
				expect(presentation, testCase.name).toBeUndefined();
		}
	});

	it('rejects malformed and downgraded lane assignments', () => {
		const explicit = serializeSequitToml(explicitLaneLogicDocument());
		const missingLane = explicit.replace('lane = "left"', 'lane = "missing"');
		const unknown = parseSequitToml(missingLane);
		expect(unknown).toMatchObject({ ok: false });
		if (unknown.ok) throw new Error('Expected unknown lane to fail');
		expect(unknown.diagnostics.some(({ path }) => path.at(-1) === 'lane')).toBe(true);

		const downgraded = parseSequitToml(
			explicit.replace('persistenceFormat = 3', 'persistenceFormat = 2'),
		);
		expect(downgraded).toMatchObject({ ok: false });
		if (downgraded.ok) throw new Error('Expected downgraded lanes to fail');
		expect(downgraded.diagnostics.map(({ path }) => path.join('.'))).toContain('presentation');

		const futureSchema = parseSequitToml(
			explicit.replace('schemaVersion = 1', 'schemaVersion = 2'),
		);
		expect(futureSchema).toMatchObject({ ok: false });
		if (futureSchema.ok) throw new Error('Expected future schema to fail');
		expect(futureSchema.diagnostics.map(({ path }) => path.join('.'))).toContain(
			'presentation.schemaVersion',
		);
	});
});
