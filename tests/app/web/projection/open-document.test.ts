import { describe, expect, it, vi } from 'vitest';

import {
	connectedNodeCreation,
	nodeCreation,
	relationCreation,
} from '../../../../src/app/web/document/document-commands';
import { createLocalDocumentSession } from '../../../../src/app/web/document/local-document-session';
import { LayoutProjectionError } from '../../../../src/app/web/projection/layout-diagnostic';
import {
	createSharedCanvasProjection,
	openDocument,
} from '../../../../src/app/web/projection/open-document';
import {
	GroupState,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type { DocumentSession } from '../../../../src/lib/infrastructure/collaboration/collaborative-document-session-types';
import { SessionNoticeCode } from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import {
	DocumentCommandDiagnosticCode,
	DocumentCommandOutcomeKind,
} from '../../../../src/lib/infrastructure/document/document-command-contracts';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import { crossingDocument } from '../../../support/fixtures';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

async function accept(
	opened: { readonly session: DocumentSession },
	commands: readonly SharedDocumentCommand[],
): Promise<void> {
	expect((await opened.session.dispatch(commands)).kind).toBe(DocumentCommandOutcomeKind.Accepted);
}

describe('openDocument', () => {
	it('opens persisted lanes and projects their shared geometry', async () => {
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'lane-open');
		const document: LogicDocument = {
			...source,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [
					{ id: 'left', label: 'Left', layoutOrder: orderKey('a0') },
					{ id: 'right', label: 'Right', layoutOrder: orderKey('a1') },
				],
			},
			nodes: source.nodes.map((node) => {
				let laneId = 'right';
				if (node.id === 'B') laneId = 'left';
				return { ...node, laneId };
			}),
		};
		const result = openDocument(serializeSequitToml(document));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		try {
			const canvas = await result.value.createCanvasModel(
				layoutMeasurementsForCanvas(result.value.measurementModel),
			);
			expect(canvas.lanes?.map(({ id }) => id)).toEqual(['left', 'right']);
			expect(canvas.relations.map(({ id }) => id)).toEqual(['R']);
		} finally {
			result.value.destroy();
		}
	});

	it('returns normalized parser diagnostics without starting downstream projections', () => {
		const result = openDocument('persistenceFormat = [');
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected parser diagnostics');

		expect(result.diagnostics[0]).toMatchObject({
			code: 'toml-syntax',
			path: [],
		});
		expect(result.diagnostics[0]?.line).toBeTypeOf('number');
		expect(result.diagnostics[0]?.column).toBeTypeOf('number');
	});

	it('returns graph diagnostics when the persisted relation targets an unknown endpoint', async () => {
		const source = (await aiDocumentaryEffortScenario()).replace(
			'from = "word-alcoa-question"',
			'from = "missing-endpoint"',
		);
		const sessionFactory = vi.fn(createLocalDocumentSession);

		expect(openDocument(source, sessionFactory)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'unknown-endpoint',
					message: 'Unknown relation source: missing-endpoint',
					path: ['relations', 'word-alcoa-question-to-traceable-edits', 'from'],
				},
			],
		});
		expect(sessionFactory).not.toHaveBeenCalled();
	});

	it('returns a diagnostic when session creation fails', async () => {
		const failure = new Error('Session unavailable');
		const result = openDocument(await aiDocumentaryEffortScenario(), () => {
			throw failure;
		});

		expect(result).toEqual({
			ok: false,
			diagnostics: [{ code: 'open-document-failed', message: failure.message, path: [] }],
		});
	});

	it('preserves the message from a session creation error', async () => {
		expect(
			openDocument(await aiDocumentaryEffortScenario(), () => {
				throw new Error('Session unavailable');
			}),
		).toMatchObject({
			ok: false,
			diagnostics: [
				{
					code: 'open-document-failed',
					message: 'Session unavailable',
					path: [],
				},
			],
		});
	});

	it('destroys the session when opened-document construction fails', async () => {
		const source = await aiDocumentaryEffortScenario();
		const destroyed = vi.fn();
		const sessionFactory = vi.fn((document: LogicDocument) => {
			const session = createLocalDocumentSession(document);
			vi.spyOn(session, 'subscribe').mockImplementation(() => {
				throw new Error('Subscription unavailable');
			});
			vi.spyOn(session, 'destroy').mockImplementation(destroyed);
			return session;
		});

		const result = openDocument(source, sessionFactory);

		expect(result).toMatchObject({ ok: false });
		expect(destroyed).toHaveBeenCalledOnce();
	});

	it('preserves result diagnostics when failed construction cleanup also fails', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario(), (document) => {
			const session = createLocalDocumentSession(document);
			vi.spyOn(session, 'subscribe').mockImplementation(() => {
				throw new Error('Subscription unavailable');
			});
			vi.spyOn(session, 'destroy').mockImplementation(() => {
				throw new Error('Cleanup unavailable');
			});
			return session;
		});

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'open-document-failed',
					message: 'Subscription unavailable',
					path: [],
				},
				{
					code: 'open-document-cleanup-failed',
					message: 'Cleanup unavailable',
					path: [],
				},
			],
		});
	});

	it('uses the same immutable measurement projection across repeated layouts', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const measurementModel = result.value.measurementModel;
		const measurements = layoutMeasurementsForCanvas(measurementModel);

		const first = await result.value.createCanvasModel(measurements);
		const second = await result.value.createCanvasModel(measurements);

		expect(result.value.measurementModel).toBe(measurementModel);
		expect(second).toEqual(first);
		expect(first.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'ALCOA+: All edits needs to be tracable\n',
		);
	});

	it('rejects layout from the returned application port when measurements are incomplete', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const complete = layoutMeasurementsForCanvas(result.value.measurementModel);
		const incomplete = { ...complete, nodes: new Map(complete.nodes) };
		incomplete.nodes.delete('traceable-edits');

		await expect(result.value.createCanvasModel(incomplete)).rejects.toThrow(
			'Missing node measurement: traceable-edits',
		);
	});

	it('reports the current valid document on layout failure and recovers on the next measurement', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const initial = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);
		await accept(result.value, [
			nodeCreation({ id: 'current-node', natureId: 'goal', markdown: 'Current' }),
		]);
		const complete = layoutMeasurementsForCanvas(result.value.measurementModel);
		const incomplete = { ...complete, nodes: new Map(complete.nodes) };
		incomplete.nodes.delete('current-node');

		let failure: unknown;
		try {
			await result.value.createCanvasModel(incomplete);
		} catch (cause) {
			failure = cause;
		}
		expect(failure).toBeInstanceOf(LayoutProjectionError);
		if (!(failure instanceof LayoutProjectionError)) throw new Error('Expected layout diagnostic');
		expect(failure.diagnostic.nodeIds).toContain('current-node');
		expect(failure.diagnostic.reason).toMatchObject({
			code: 'missing-node-measurement',
			elementId: 'current-node',
		});
		expect(failure.diagnostic.nodeIds).not.toContain('missing-node');
		expect(initial.nodes.map(({ id }) => id)).not.toContain('current-node');

		const recovered = await result.value.createCanvasModel(complete);
		expect(recovered.nodes.map(({ id }) => id)).toContain('current-node');
	});

	it('refreshes the projection and renders added independent peers in operation order', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');

		await accept(result.value, [
			nodeCreation({ id: 'zz-added-first', natureId: 'goal', markdown: 'Added first' }),
		]);
		await accept(result.value, [
			nodeCreation({ id: 'aa-added-second', natureId: 'goal', markdown: 'Added second' }),
		]);
		const canvas = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);
		const first = canvas.nodes.find(({ id }) => id === 'zz-added-first');
		const second = canvas.nodes.find(({ id }) => id === 'aa-added-second');

		expect(result.value.measurementModel.nodes).toHaveLength(26);
		expect(result.value.measurementModel.nodes.map(({ id }) => id)).toEqual(
			expect.arrayContaining(['zz-added-first', 'aa-added-second']),
		);
		expect(first?.bounds.y).toBe(second?.bounds.y);
		expect(first?.bounds.x).toBeLessThan(second?.bounds.x ?? 0);
	});

	it('adds a node and its parent relations through one opened-document command', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const beforeNodes = result.value.read().nodes.length;
		const beforeRelations = result.value.read().relations.length;

		await accept(
			result.value,
			connectedNodeCreation({ id: 'connected-child', natureId: 'goal', markdown: '' }, [
				{ id: 'connected-child-to-parent', from: 'connected-child', to: 'traceable-edits' },
			]),
		);

		expect(result.value.read().nodes).toHaveLength(beforeNodes + 1);
		expect(result.value.read().relations).toHaveLength(beforeRelations + 1);
		expect(result.value.read().relations).toContainEqual({
			id: 'connected-child-to-parent',
			from: 'connected-child',
			to: 'traceable-edits',
		});
	});

	it('saves changed Markdown through the node text and reprojects the accepted document', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const updates = vi.fn();
		result.value.subscribe(updates);
		const base = result.value.readNode('traceable-edits');
		if (base === undefined) throw new Error('Expected the editable node');

		const outcome = await result.value.saveNode('traceable-edits', base, {
			...base,
			markdown: 'Opened-document replacement',
		});
		const canvas = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		if (outcome.kind !== DocumentCommandOutcomeKind.Accepted)
			throw new Error('Expected acceptance');
		expect(outcome.document.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'Opened-document replacement',
		);
		expect(
			result.value.measurementModel.nodes.find(({ id }) => id === 'traceable-edits')?.markdown,
		).toBe('Opened-document replacement');
		expect(canvas.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'Opened-document replacement',
		);
		expect(updates).toHaveBeenCalledOnce();
	});

	it('notifies subscribers of a title-only change and folds a closed group locally', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const updates = vi.fn();
		result.value.subscribe(updates);

		expect(
			result.value.session.updateText(
				{ kind: SharedElementKind.Document, id: result.value.read().id },
				'title',
				'Titre renommé',
			),
		).toBe(true);
		expect(updates).toHaveBeenCalledOnce();
		expect(result.value.read().title).toBe('Titre renommé');

		const members = result.value.read().nodes.filter(({ groupId }) => groupId === 'use-cases');
		const closed = await result.value.session.dispatch([
			{
				op: SharedCommandKind.Update,
				target: { kind: SharedElementKind.Group, id: 'use-cases' },
				set: { state: GroupState.Closed },
				unset: [],
			},
		]);
		expect(closed.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		expect(result.value.measurementModel.nodes.map(({ id }) => id)).not.toContain(members[0]?.id);
		const canvas = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);
		expect(canvas.groups.find(({ id }) => id === 'use-cases')?.state).toBe(GroupState.Closed);
		expect(canvas.nodes).toHaveLength(result.value.read().nodes.length - members.length);
		expect(result.value.read().nodes).toHaveLength(24);
	});

	it('dispatches one Update when only the node colour changes', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const base = result.value.readNode('traceable-edits');
		if (base === undefined) throw new Error('Expected the editable node');
		const dispatch = vi.spyOn(result.value.session, 'dispatch');

		const outcome = await result.value.saveNode('traceable-edits', base, {
			...base,
			color: '#123456',
		});

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		expect(dispatch).toHaveBeenCalledExactlyOnceWith([
			{
				op: SharedCommandKind.Update,
				target: { kind: SharedElementKind.Node, id: 'traceable-edits' },
				set: { color: '#123456' },
				unset: [],
			},
		]);
		expect(result.value.read().nodes.find(({ id }) => id === 'traceable-edits')?.color).toBe(
			'#123456',
		);
	});

	it('forwards group presentation updates and reprojects the canvas group', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const original = result.value.read().groups.find(({ id }) => id === 'use-cases');
		if (original === undefined) throw new Error('Expected the use-cases group');

		const group = { kind: SharedElementKind.Group, id: original.id } as const;
		expect(result.value.session.updateText(group, 'label', 'Cas d’usage')).toBe(true);
		await accept(result.value, [
			{ op: SharedCommandKind.Update, target: group, set: { color: '#2563eb' }, unset: [] },
		]);
		const canvas = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);

		expect(canvas.groups.find(({ id }) => id === original.id)).toMatchObject({
			label: 'Cas d’usage',
			color: '#2563eb',
		});
	});

	it('isolates opened-document subscribers and supports explicit unsubscription', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const isolated = vi.fn(() => {
			throw new Error('Isolated opened subscriber');
		});
		const skipped = vi.fn();
		result.value.subscribe(isolated);
		const unsubscribe = result.value.subscribe(skipped);
		unsubscribe();
		const later = vi.fn();
		result.value.subscribe(later);

		const base = result.value.readNode('traceable-edits');
		if (base === undefined) throw new Error('Expected the editable node');
		await result.value.saveNode('traceable-edits', base, {
			...base,
			markdown: 'Subscriber isolation',
		});

		expect(isolated).toHaveBeenCalledOnce();
		expect(skipped).not.toHaveBeenCalled();
		expect(later).toHaveBeenCalledOnce();
	});

	it('rejects missing-node and closed-session edits and reads a missing node as undefined', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const base = result.value.readNode('traceable-edits');
		if (base === undefined) throw new Error('Expected the editable node');

		expect(result.value.readNode('missing')).toBeUndefined();
		await expect(
			result.value.saveNode('missing', base, { ...base, markdown: 'Ignored' }),
		).resolves.toMatchObject({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [
				{
					code: DocumentCommandDiagnosticCode.NodeNotFound,
					reason: { code: SessionNoticeCode.NodeNotFound, nodeId: 'missing' },
				},
			],
		});
		result.value.destroy();
		await expect(
			result.value.saveNode('traceable-edits', base, {
				...base,
				markdown: 'Ignored after close',
			}),
		).resolves.toMatchObject({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [
				{
					code: DocumentCommandDiagnosticCode.SessionClosed,
					reason: { code: SessionNoticeCode.Destroyed },
				},
			],
		});
		const inertUnsubscribe = result.value.subscribe(vi.fn());
		expect(inertUnsubscribe).toBeTypeOf('function');
		inertUnsubscribe();
		expect(() => {
			result.value.destroy();
		}).not.toThrow();
	});

	it('reprojects an edited relation without displacing unrelated canvas nodes', async () => {
		const result = openDocument(crossingDocument);
		if (!result.ok) throw new Error('Expected the crossing document to open');
		const before = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);
		const successorBefore = before.nodes.find(({ id }) => id === 'successor')?.bounds;
		const isolatedBefore = before.nodes.find(({ id }) => id === 'isolated')?.bounds;

		await accept(result.value, [
			relationCreation({ id: 'source-a-to-target-b', from: 'source-a', to: 'target-b' }),
		]);
		const after = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);
		const bounds = new Map(after.nodes.map(({ id, bounds: nodeBounds }) => [id, nodeBounds]));

		const source = bounds.get('source-a');
		const target = bounds.get('target-b');
		const added = after.relations.find(({ id }) => id === 'source-a-to-target-b');
		if (source === undefined || target === undefined || added === undefined)
			throw new Error('The new relation or its endpoints were not projected');
		expect(added.points[0]?.y).toBe(source.y);
		expect(added.points.at(-1)?.y).toBe(target.y + target.height);
		expect(added.points[0]?.x).toBeGreaterThanOrEqual(source.x);
		expect(added.points[0]?.x).toBeLessThanOrEqual(source.x + source.width);
		expect(added.points.at(-1)?.x).toBeGreaterThanOrEqual(target.x);
		expect(added.points.at(-1)?.x).toBeLessThanOrEqual(target.x + target.width);
		expect(bounds.get('target-a')?.y).toBe(target.y);
		expect(bounds.get('source-a')?.y).toBe(bounds.get('source-b')?.y);
		expect(bounds.get('successor')).toEqual(successorBefore);
		expect(bounds.get('isolated')).toEqual(isolatedBefore);
	});
});

it('projects shared group state without removing the original members', async () => {
	const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'room');
	const open = createSharedCanvasProjection(source);
	expect(open.measurementModel.nodes).toHaveLength(2);
	const closed = createSharedCanvasProjection({
		...source,
		groups: source.groups.map((group) => ({
			...group,
			state: GroupState.Closed,
		})),
	});
	expect(closed.measurementModel.nodes).toEqual([]);
	const stop = closed.subscribe(() => undefined);
	stop();
	const canvas = await closed.createCanvasModel(
		layoutMeasurementsForCanvas(closed.measurementModel),
	);
	expect(canvas.groups.map((group) => group.id)).toEqual(['G']);
	expect(source.nodes).toHaveLength(2);
});

it('reports an invalid shared snapshot instead of rendering dangling relations', () => {
	const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
	expect(() =>
		createSharedCanvasProjection({
			...source,
			relations: [{ id: 'dangling', from: 'missing', to: 'A' }],
		}),
	).toThrow();
});

it('keeps a shared projection invalid until the physical source heals', async () => {
	const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
	const projection = createSharedCanvasProjection(source);
	const measurements = layoutMeasurementsForCanvas(projection.measurementModel);
	const before = await projection.createCanvasModel(measurements);
	const incomplete = { ...measurements, nodes: new Map(measurements.nodes) };
	incomplete.nodes.delete('A');
	const subscriber = vi.fn();
	projection.subscribe(subscriber);

	await expect(projection.createCanvasModel(incomplete)).rejects.toBeInstanceOf(
		LayoutProjectionError,
	);
	projection.update(source);
	expect(subscriber).toHaveBeenCalledOnce();
	expect(await projection.createCanvasModel(measurements)).toEqual(before);
});
