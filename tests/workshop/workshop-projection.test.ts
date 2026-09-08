import { describe, expect, it } from 'vitest';

import { defined, EndpointKind, JunctionOperator } from '../../src/lib/document/logic-document';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import source from '../../src/routes/atelier/branching.toml?raw';
import {
	collapsedDocument,
	projectWorkshop,
} from '../../src/routes/atelier/runtime/workshop-projection';
const parsed = parseSequitToml(source);
if (!parsed.ok) throw new Error('Invalid fixture');
const model = parsed.value;
const group = {
	kind: EndpointKind.Group as const,
	id: 'group',
	label: 'Branche',
	layoutOrder: 'b00',
};
const nested = { ...group, id: 'nested', groupId: 'group', layoutOrder: 'b01' };
const grouped = {
	...model,
	groups: [group, nested],
	nodes: model.nodes.map((node) => {
		if (node.id === 'collecter' || node.id === 'explorer') return { ...node, groupId: 'nested' };
		return node;
	}),
	junctions: [
		{
			kind: EndpointKind.Junction as const,
			id: 'xor',
			operator: JunctionOperator.Xor,
			groupId: 'nested',
			layoutOrder: 'b02',
		},
	],
};
describe('workshop canvas projections', () => {
	it('contracts nested groups and deduplicates their external relations without changing source', () => {
		const before = structuredClone(grouped);
		const view = collapsedDocument(grouped, ['group', 'nested']);
		expect(view.groups.map((item) => item.id)).toEqual(['group']);
		expect(view.junctions).toHaveLength(0);
		expect(view.nodes).toHaveLength(2);
		expect(view.relations).toEqual(
			expect.arrayContaining([expect.objectContaining({ from: 'group', to: 'comparer' })]),
		);
		expect(view.relations.filter((item) => item.from === 'group')).toHaveLength(1);
		expect(grouped).toEqual(before);
		expect(collapsedDocument(grouped, [])).toEqual(grouped);
	});
	it('removes internal edges of a collapsed group', () => {
		const view = collapsedDocument(
			{
				...grouped,
				relations: [...grouped.relations, { id: 'internal', from: 'collecter', to: 'explorer' }],
			},
			['group'],
		);
		expect(view.relations.some((item) => item.id === 'internal')).toBe(false);
	});
	it('rejects a non-convex collapse that would reverse graph meaning', () => {
		const nonconvex = {
			...model,
			groups: [group],
			nodes: model.nodes.map((node) => {
				if (node.id === 'collecter' || node.id === 'decider') return { ...node, groupId: 'group' };
				return node;
			}),
		};
		expect(() => projectWorkshop(nonconvex, ['group'], 1)).toThrow('sort puis revient');
	});
	it('spaces real layouts while keeping the measured boxes and reconnecting arrows', async () => {
		const measurements = {
			nodes: new Map(model.nodes.map((node) => [node.id, { width: 220, height: 80 }])),
			groups: new Map(),
			junctions: new Map(),
		};
		const normal = projectWorkshop(model, [], 1);
		normal.subscribe()();
		const compact = await normal.createCanvasModel(measurements);
		const airy = await projectWorkshop(model, [], 1.7).createCanvasModel(measurements);
		expect(airy.height).toBeGreaterThan(compact.height);
		expect(airy.nodes.map((node) => node.bounds.width)).toEqual([220, 220, 220, 220]);
		for (const relation of airy.relations) {
			const from = defined(airy.nodes.find((node) => node.id === relation.from));
			expect(relation.points[0]?.y).toBe(from.bounds.y + from.bounds.height);
		}
	});
	it('projects a collapsed group using the shared group measurements', async () => {
		const view = projectWorkshop(grouped, ['group'], 1.4);
		const result = await view.createCanvasModel({
			nodes: new Map(model.nodes.map((node) => [node.id, { width: 220, height: 80 }])),
			groups: new Map([
				['group', { minimumWidth: 200, minimumHeight: 100, headerHeight: 30, padding: 20 }],
			]),
			junctions: new Map(),
		});
		expect(result.groups).toHaveLength(1);
		expect(result.nodes).toHaveLength(2);
		expect(result.relations).toHaveLength(2);
	});
});
