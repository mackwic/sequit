import { describe, expect, it } from 'vitest';

import {
	NormalizedLaneKind,
	normalizeRootLayout,
} from '../../../../src/lib/core/document/layout-presentation';
import {
	LANE_PERSISTENCE_FORMAT,
	LaneOrientation,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../support/builders/logic-document';

function diagnosticPaths(document: LogicDocument): string[] {
	const result = validateLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

describe('root layout presentation', () => {
	it('derives an unwritten root and lane for legacy documents', () => {
		const document = validLogicDocument();
		const normalized = normalizeRootLayout(document);
		expect(normalized.policy).toBe(LayoutPolicy.Layered);
		expect(normalized.lanes).toEqual([{ kind: NormalizedLaneKind.Implicit }]);
		expect(normalized.laneByEndpointId.get('source-a')).toBeUndefined();
		expect(document).not.toHaveProperty('presentation');
	});

	it('resolves explicit top-level ownership and descendant inheritance', () => {
		const document = explicitLaneLogicDocument();
		expect(diagnosticPaths(document)).toEqual([]);
		const normalized = normalizeRootLayout(document);
		expect(normalized.laneOrientation).toBe(LaneOrientation.Parallel);
		expect(normalized.lanes.map(({ kind }) => kind)).toEqual([
			NormalizedLaneKind.Explicit,
			NormalizedLaneKind.Explicit,
		]);
		expect(normalized.laneByEndpointId.get('source-a')).toBe('left');
		expect(normalized.laneByEndpointId.get('choice')).toBe('left');
		expect(normalized.laneByEndpointId.get('isolated')).toBe('right');
	});

	it('uses layoutOrder for lanes even when the document array is reversed', () => {
		const document = explicitLaneLogicDocument();
		const presentation = document.presentation;
		if (!presentation) throw new Error('Fixture needs presentation');
		const reversed = {
			...document,
			presentation: { ...presentation, lanes: [...presentation.lanes].reverse() },
		};
		const normalized = normalizeRootLayout(reversed);
		const ids = normalized.lanes.map((lane) => {
			if (lane.kind === NormalizedLaneKind.Implicit) throw new Error('Expected explicit lane');
			return lane.id;
		});
		expect(ids).toEqual(['left', 'right']);
	});

	it('orders equal lane positions by canonical identifier', () => {
		const document = explicitLaneLogicDocument();
		const presentation = document.presentation;
		if (!presentation) throw new Error('Fixture needs presentation');
		const [left, right] = presentation.lanes;
		if (!left || !right) throw new Error('Fixture needs two lanes');
		const tied = {
			...document,
			presentation: {
				...presentation,
				lanes: [{ ...right, layoutOrder: left.layoutOrder }, left],
			},
		};
		expect(
			normalizeRootLayout(tied).lanes.map((lane) => {
				if (lane.kind === NormalizedLaneKind.Explicit) return lane.id;
				return 'implicit';
			}),
		).toEqual(['left', 'right']);
	});

	it('rejects cyclic group ownership before trying to inherit a lane', () => {
		const document = explicitLaneLogicDocument();
		const groups = document.groups.map((group) => {
			if (group.id === 'container' || group.id === 'endpoint-group') {
				let groupId = 'container';
				if (group.id === 'container') groupId = 'endpoint-group';
				const changed = {
					...group,
					groupId,
				};
				delete changed.laneId;
				return changed;
			}
			return group;
		});
		expect(() => normalizeRootLayout({ ...document, groups })).toThrow(
			'Group containment cycle at container',
		);
	});

	it('rejects malformed ownership at the endpoint path', () => {
		const source = explicitLaneLogicDocument();
		const [first, ...rest] = source.nodes;
		if (!first) throw new Error('Fixture needs a node');
		const nestedOverride = {
			...source,
			nodes: [{ ...first, laneId: 'right' }, ...rest],
		};
		expect(diagnosticPaths(nestedOverride)).toContain('nodes.source-a.lane');

		const missing = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id !== 'target') return node;
				const result = { ...node };
				delete result.laneId;
				return result;
			}),
		};
		expect(diagnosticPaths(missing)).toContain('nodes.target.lane');
		const groups = source.groups.map((group) => {
			if (group.id === 'container') return { ...group, laneId: 'unknown' };
			return group;
		});
		expect(diagnosticPaths({ ...source, groups })).toContain('groups.container.lane');
	});

	it('rejects presentation with too few lanes', () => {
		const source = explicitLaneLogicDocument();
		const presentation = source.presentation;
		if (!presentation) throw new Error('Fixture needs presentation');
		expect(
			diagnosticPaths({
				...source,
				presentation: { ...presentation, lanes: presentation.lanes.slice(0, 1) },
			}),
		).toContain('presentation.lanes');
	});

	it('rejects unsupported root policy, orientation, growth, and schema values', () => {
		const document = explicitLaneLogicDocument();
		const presentation = document.presentation;
		if (!presentation) throw new Error('Fixture needs presentation');
		const cases = [
			{ field: 'schemaVersion', value: 2, path: 'presentation.schemaVersion' },
			{ field: 'policy', value: 'force', path: 'presentation.policy' },
			{ field: 'laneOrientation', value: 'diagonal', path: 'presentation.laneOrientation' },
			{ field: 'growth', value: 'fixed', path: 'presentation.growth' },
		] as const;
		for (const testCase of cases) {
			const malformed = { ...presentation };
			Reflect.set(malformed, testCase.field, testCase.value);
			expect(diagnosticPaths({ ...document, presentation: malformed }), testCase.field).toContain(
				testCase.path,
			);
		}
	});

	it('rejects duplicate, empty, and malformed lane definitions', () => {
		const document = explicitLaneLogicDocument();
		const presentation = document.presentation;
		if (!presentation) throw new Error('Fixture needs presentation');
		const [left, right] = presentation.lanes;
		if (!left || !right) throw new Error('Fixture needs two lanes');
		const withLanes = (lanes: typeof presentation.lanes): LogicDocument => ({
			...document,
			presentation: { ...presentation, lanes },
		});
		expect(diagnosticPaths(withLanes([left, { ...right, id: left.id }]))).toContain(
			'presentation.lanes.left',
		);
		expect(diagnosticPaths(withLanes([{ ...left, id: '' }, right]))).toContain(
			'presentation.lanes.',
		);
		const malformedOrder = { ...left };
		Reflect.set(malformedOrder, 'layoutOrder', 'not-an-order-key');
		expect(diagnosticPaths(withLanes([malformedOrder, right]))).toContain(
			'presentation.lanes.left.layoutOrder',
		);
	});

	it('rejects lane assignments in legacy documents and missing presentation in format 3', () => {
		const legacy = validLogicDocument();
		const nodes = legacy.nodes.map((node) => {
			if (node.id === 'target') return { ...node, laneId: 'left' };
			return node;
		});
		expect(diagnosticPaths({ ...legacy, nodes })).toContain('nodes.target.lane');
		const explicit = explicitLaneLogicDocument();
		expect(diagnosticPaths({ ...explicit, persistenceFormat: PERSISTENCE_FORMAT })).toContain(
			'presentation',
		);
		expect(diagnosticPaths({ ...legacy, persistenceFormat: LANE_PERSISTENCE_FORMAT })).toContain(
			'presentation',
		);
	});
});
