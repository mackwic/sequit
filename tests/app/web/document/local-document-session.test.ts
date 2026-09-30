import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { nodeCreation, relationCreation } from '../../../../src/app/web/document/document-commands';
import {
	attachLocalDocumentSession,
	createLocalDocumentSession,
} from '../../../../src/app/web/document/local-document-session';
import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import {
	type SourceDocumentState,
	SourceDocumentStateKind,
} from '../../../../src/lib/infrastructure/collaboration/source-document-state';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	DocumentCommandDiagnosticCode,
	DocumentCommandOutcomeKind,
	sessionClosedOutcome,
} from '../../../../src/lib/infrastructure/document/document-command-contracts';
import {
	DocumentSessionError,
	DocumentSessionErrorKind,
	type DocumentSessionErrorReporter,
} from '../../../../src/lib/infrastructure/document/document-session-contracts';
import {
	type SharedDocumentCommand,
	SharedElementKind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

async function reference(): Promise<LogicDocument> {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	return parsed.value;
}

async function attached(reportError?: DocumentSessionErrorReporter) {
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, await reference());
	return { session: attachLocalDocumentSession(ydoc, reportError), ydoc };
}

function markdownOf(ydoc: Y.Doc, nodeId: string): Y.Text {
	const markdown = ydoc.getMap<Y.Map<unknown>>('sequit.nodes').get(nodeId)?.get('markdown');
	if (!(markdown instanceof Y.Text)) throw new Error('Expected shared Markdown');
	return markdown;
}

const goal = (id: string) => nodeCreation({ id, natureId: 'goal', markdown: id });

describe('local document session commands', () => {
	it('publishes an accepted batch exactly once and resolves with the published document', async () => {
		const { session } = await attached();
		const subscriber = vi.fn();
		session.subscribe(subscriber);

		const outcome = await session.dispatch([goal('new-goal')]);

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		if (outcome.kind !== DocumentCommandOutcomeKind.Accepted)
			throw new Error('Expected acceptance');
		expect(outcome.document.nodes).toContainEqual(
			expect.objectContaining({ id: 'new-goal', natureId: 'goal', markdown: 'new-goal' }),
		);
		expect(subscriber).toHaveBeenCalledExactlyOnceWith(outcome.document);
		expect(session.read()).toBe(outcome.document);
	});

	it.each([
		[
			'a relation closing a cycle',
			(document: LogicDocument): SharedDocumentCommand => {
				const relation = document.relations[0];
				if (relation === undefined) throw new Error('Expected a reference relation');
				return relationCreation({ id: 'reverse', from: relation.to, to: relation.from });
			},
		],
		['a creation reusing an existing id', () => goal('traceable-edits')],
	])('refuses %s without touching the document', async (_name, command) => {
		const { session, ydoc } = await attached();
		const accepted = session.read();
		const subscriber = vi.fn();
		const updates = vi.fn();
		session.subscribe(subscriber);
		ydoc.on('update', updates);
		const before = Y.encodeStateVector(ydoc);

		const outcome = await session.dispatch([goal('discarded-with-batch'), command(accepted)]);

		expect(outcome).toMatchObject({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [{ code: DocumentCommandDiagnosticCode.CommandRefused, path: [] }],
		});
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
		expect(updates).not.toHaveBeenCalled();
		expect(subscriber).not.toHaveBeenCalled();
		expect(session.read()).toBe(accepted);
	});

	it('fails a batch the executor cannot interpret', async () => {
		const { session, ydoc } = await attached();
		const before = Y.encodeStateVector(ydoc);
		const foreign = { id: 'foreign', natureId: 'goal', markdown: '', unknownField: 'x' };

		const outcome = await session.dispatch([nodeCreation(foreign)]);

		expect(outcome).toMatchObject({ kind: DocumentCommandOutcomeKind.Failed });
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
	});

	it('runs batches one at a time in dispatch order', async () => {
		const { session } = await attached();
		const published: string[][] = [];
		session.subscribe((document) => {
			published.push(document.nodes.map(({ id }) => id).filter((id) => id.startsWith('queued-')));
		});

		const first = session.dispatch([goal('queued-first')]);
		const second = session.dispatch([
			goal('queued-second'),
			relationCreation({ id: 'queued-link', from: 'queued-first', to: 'queued-second' }),
		]);
		const outcomes = await Promise.all([first, second]);

		expect(outcomes.map(({ kind }) => kind)).toEqual([
			DocumentCommandOutcomeKind.Accepted,
			DocumentCommandOutcomeKind.Accepted,
		]);
		expect(published).toEqual([['queued-first'], ['queued-first', 'queued-second']]);
	});

	it('refuses a command on an already invalid physical document', async () => {
		const report = vi.fn();
		const { session, ydoc } = await attached(report);
		ydoc.getMap('sequit.nodes').delete('traceable-edits');
		report.mockClear();

		const outcome = await session.dispatch([goal('blocked')]);

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Rejected);
		expect(ydoc.getMap('sequit.nodes').has('blocked')).toBe(false);
		expect(report).not.toHaveBeenCalled();
	});

	it('rejects its own materialization when a document hook invalidates it', async () => {
		const report = vi.fn();
		const { session, ydoc } = await attached(report);
		const accepted = session.read();
		const subscriber = vi.fn();
		session.subscribe(subscriber);
		ydoc.on('beforeTransaction', (transaction: Y.Transaction) => {
			if (typeof transaction.origin === 'symbol')
				ydoc.getMap('sequit.nodes').delete('traceable-edits');
		});

		const outcome = await session.dispatch([goal('poisoned')]);

		expect(outcome).toMatchObject({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [{ code: 'invalid-yjs-live-document' }],
		});
		expect(subscriber).not.toHaveBeenCalled();
		expect(report).not.toHaveBeenCalled();
		expect(session.read()).toBe(accepted);
	});
});

describe('local document session text', () => {
	it('edits Markdown through its stable shared text', async () => {
		const { session, ydoc } = await attached();
		const text = markdownOf(ydoc, 'traceable-edits');
		const subscriber = vi.fn();
		session.subscribe(subscriber);

		expect(
			session.updateText({ kind: SharedElementKind.Node, id: 'missing' }, 'markdown', 'Ignored'),
		).toBe(false);
		expect(subscriber).not.toHaveBeenCalled();
		expect(
			session.updateText(
				{ kind: SharedElementKind.Node, id: 'traceable-edits' },
				'markdown',
				'Replacement',
			),
		).toBe(true);

		expect(subscriber).toHaveBeenCalledOnce();
		expect(session.read().nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'Replacement',
		);
		expect(markdownOf(ydoc, 'traceable-edits')).toBe(text);
		expect(session.text({ kind: SharedElementKind.Node, id: 'traceable-edits' }, 'markdown')).toBe(
			text,
		);
		expect(
			session.updateText(
				{ kind: SharedElementKind.Node, id: 'traceable-edits' },
				'markdown',
				'Replacement',
			),
		).toBe(true);
		expect(subscriber).toHaveBeenCalledOnce();
	});

	it('refuses a text edit bound to a replaced text', async () => {
		const { session } = await attached();
		const target = { kind: SharedElementKind.Node, id: 'traceable-edits' } as const;

		expect(session.updateText(target, 'markdown', 'Stale', new Y.Text('detached'))).toBe(false);
		expect(session.updateText(target, 'markdown', 'Bound', session.text(target, 'markdown'))).toBe(
			true,
		);
		expect(session.read().nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe('Bound');
	});
});

describe('local document session publication', () => {
	it('publishes a valid remote transaction exactly once', async () => {
		const { session, ydoc } = await attached();
		const subscriber = vi.fn();
		session.subscribe(subscriber);

		ydoc.transact(() => {
			markdownOf(ydoc, 'traceable-edits').insert(0, 'Remote ');
		}, 'remote-provider');

		expect(subscriber).toHaveBeenCalledOnce();
		expect(session.read().nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toMatch(
			/^Remote /,
		);
	});

	it('reports an invalid remote transaction and keeps the last valid publication', async () => {
		const report = vi.fn<DocumentSessionErrorReporter>();
		const { session, ydoc } = await attached(report);
		const accepted = session.read();
		const subscriber = vi.fn();
		const sources: SourceDocumentState[] = [];
		session.subscribe(subscriber);
		session.subscribeToSourceState((state) => sources.push(state));
		const replica = new Y.Doc();
		Y.applyUpdate(replica, Y.encodeStateAsUpdate(ydoc));
		const replicaState = Y.encodeStateVector(replica);
		replica.getMap('sequit.nodes').delete('traceable-edits');

		expect(() => {
			Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(replica, replicaState), 'remote');
		}).not.toThrow();

		expect(report).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ kind: DocumentSessionErrorKind.RejectedExternalTransaction }),
		);
		const [reported] = report.mock.calls[0] ?? [];
		if (reported?.kind !== DocumentSessionErrorKind.RejectedExternalTransaction)
			throw new Error('Expected a rejected external transaction report');
		expect(reported.diagnostics.map(({ code }) => code)).toContain('invalid-yjs-live-document');
		expect(subscriber).not.toHaveBeenCalled();
		expect(session.read()).toBe(accepted);
		expect(sources).toEqual([session.readSourceState()]);
		expect(sources[0]).toMatchObject({ kind: SourceDocumentStateKind.Invalid, revision: 1 });
	});

	it('isolates subscriber and reporter failures', async () => {
		const failure = new Error('subscriber failed');
		const report = vi.fn(() => {
			throw new Error('reporter failed');
		});
		const { session } = await attached(report);
		const later = vi.fn();
		const laterSource = vi.fn();
		session.subscribe(() => {
			throw failure;
		});
		session.subscribe(later);
		session.subscribeToSourceState(() => {
			throw failure;
		});
		session.subscribeToSourceState(laterSource);

		const outcome = await session.dispatch([goal('isolated')]);

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		expect(later).toHaveBeenCalledOnce();
		expect(laterSource).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledWith({
			kind: DocumentSessionErrorKind.Subscriber,
			error: failure,
		});
	});

	it('queues a publication triggered while subscribers are being notified', async () => {
		const { session } = await attached();
		const observed: string[] = [];
		session.subscribe((document) => {
			if (document.nodes.some(({ id }) => id === 'outer') && observed.length === 0)
				session.updateText({ kind: SharedElementKind.Node, id: 'outer' }, 'markdown', 'Nested');
		});
		session.subscribe((document) => {
			observed.push(document.nodes.find(({ id }) => id === 'outer')?.markdown ?? '');
		});

		await session.dispatch([goal('outer')]);

		expect(observed).toEqual(['outer', 'Nested']);
		expect(session.read().nodes.find(({ id }) => id === 'outer')?.markdown).toBe('Nested');
	});

	it('discards queued publications when a subscriber destroys the session', async () => {
		const { session, ydoc } = await attached();
		const later = vi.fn();
		session.subscribe(() => {
			session.updateText(
				{ kind: SharedElementKind.Node, id: 'traceable-edits' },
				'markdown',
				'Queued',
			);
			session.destroy();
		});
		session.subscribe(later);

		markdownOf(ydoc, 'traceable-edits').insert(0, 'First ');

		expect(later).not.toHaveBeenCalled();
		expect(markdownOf(ydoc, 'traceable-edits').toJSON()).toBe('Queued');
	});

	it('stops source-state delivery when a source subscriber destroys the session', async () => {
		const { session, ydoc } = await attached();
		const later = vi.fn();
		const accepted = vi.fn();
		session.subscribe(accepted);
		session.subscribeToSourceState(() => {
			session.destroy();
		});
		session.subscribeToSourceState(later);

		markdownOf(ydoc, 'traceable-edits').insert(0, 'Destroying ');

		expect(later).not.toHaveBeenCalled();
		expect(accepted).not.toHaveBeenCalled();
	});
});

describe('local document session lifecycle', () => {
	it('closes pending batches and refuses new work after destruction', async () => {
		const { session, ydoc } = await attached();
		const pending = session.dispatch([goal('pending')]);

		session.destroy();
		session.destroy();

		await expect(pending).resolves.toEqual(sessionClosedOutcome());
		expect(ydoc.getMap('sequit.nodes').has('pending')).toBe(false);
		expect(() => session.dispatch([goal('late')])).toThrow(
			new DocumentSessionError('Document session has been destroyed'),
		);
		expect(() => session.read()).toThrow(DocumentSessionError);
		expect(() => session.readSourceState()).toThrow(DocumentSessionError);
		expect(() => session.subscribe(() => undefined)).toThrow(DocumentSessionError);
		expect(() => session.subscribeToSourceState(() => undefined)).toThrow(DocumentSessionError);
		expect(
			session.updateText(
				{ kind: SharedElementKind.Node, id: 'traceable-edits' },
				'markdown',
				'Late',
			),
		).toBe(false);
	});

	it('closes a pending batch when its borrowed document is destroyed', async () => {
		const { session, ydoc } = await attached();
		const pending = session.dispatch([goal('orphaned')]);

		ydoc.destroy();

		await expect(pending).resolves.toEqual(sessionClosedOutcome());
	});

	it('leaves a borrowed document to its owner and destroys the document it owns', async () => {
		const { session, ydoc } = await attached();
		const borrowed = vi.spyOn(ydoc, 'destroy');
		session.destroy();
		expect(borrowed).not.toHaveBeenCalled();

		const owned = createLocalDocumentSession(await reference());
		const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');
		try {
			owned.destroy();
			expect(destroy).toHaveBeenCalledOnce();
		} finally {
			destroy.mockRestore();
		}
	});

	it('refuses invalid initial documents and releases the document it created', async () => {
		const document = await reference();
		const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');
		try {
			expect(() => createLocalDocumentSession({ ...document, natures: [] })).toThrow(
				'Unknown nature',
			);
			expect(destroy).toHaveBeenCalledOnce();
		} finally {
			destroy.mockRestore();
		}
		const relation = document.relations[0];
		if (relation === undefined) throw new Error('Expected a reference relation');
		const cyclic = {
			...document,
			relations: [...document.relations, { id: 'back', from: relation.to, to: relation.from }],
		};
		expect(() => createLocalDocumentSession(cyclic)).toThrow('Cycle detected');
		expect(() => attachLocalDocumentSession(new Y.Doc())).toThrow(DocumentSessionError);
	});

	it('attaches to a populated document without replacing its shared texts', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, { ...(await reference()), title: 'Already shared' });
		const title = ydoc.getMap('sequit.meta').get('title');

		const session = attachLocalDocumentSession(ydoc);

		expect(session.read().title).toBe('Already shared');
		expect(session.readSourceState()).toMatchObject({ kind: SourceDocumentStateKind.Valid });
		expect(ydoc.getMap('sequit.meta').get('title')).toBe(title);
	});
});
