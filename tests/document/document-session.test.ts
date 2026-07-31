import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { importLogicDocument } from '../../src/lib/collaboration/yjs-document-codec';
import {
	attachDocumentSession,
	createDocumentSession,
} from '../../src/lib/collaboration/yjs-document-session';
import type {
	DocumentCommandGateway,
	DocumentCommandOutcome,
} from '../../src/lib/document/document-command-gateway';
import {
	DocumentSession,
	DocumentSessionError,
	DocumentSessionErrorKind,
	type DocumentSessionErrorReporter,
} from '../../src/lib/document/document-session';
import { EndpointKind } from '../../src/lib/document/logic-document';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

async function createSession() {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	return createDocumentSession(parsed.value);
}

async function referenceForDelayedTest() {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	return parsed.value;
}

async function createObservableSession(reportError?: DocumentSessionErrorReporter) {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, parsed.value);
	return { session: attachDocumentSession(ydoc, reportError), ydoc };
}

class FakeDocumentCommandGateway implements DocumentCommandGateway {
	readonly subscribers = new Set<(outcome: DocumentCommandOutcome) => void>();
	next: DocumentCommandOutcome;
	completion?: Promise<void>;
	dispatchError?: Error;
	publishOnDispatch = true;
	unsubscribeCalls = 0;
	destroyCalls = 0;

	constructor(readonly document: ReturnType<DocumentSession['read']>) {
		this.next = { kind: 'accepted', document };
	}

	readAccepted() {
		return this.document;
	}
	subscribe(subscriber: (outcome: DocumentCommandOutcome) => void) {
		this.subscribers.add(subscriber);
		return () => {
			this.unsubscribeCalls += 1;
			this.subscribers.delete(subscriber);
		};
	}
	destroy() {
		this.destroyCalls += 1;
		this.subscribers.clear();
	}
	publish(outcome: DocumentCommandOutcome = this.next) {
		for (const subscriber of [...this.subscribers]) subscriber(outcome);
	}
	async dispatch() {
		if (this.completion !== undefined) await this.completion;
		if (this.dispatchError !== undefined) throw this.dispatchError;
		if (this.publishOnDispatch) this.publish();
		return this.next;
	}
}

describe('document session', () => {
	it('handles every command outcome through the application gateway port', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const gateway = new FakeDocumentCommandGateway(parsed.value);
		const session = new DocumentSession(gateway);
		const subscriber = vi.fn();
		session.subscribe(subscriber);
		const node = { id: 'test', natureId: 'goal', markdown: 'Test' };
		const accepted = { ...parsed.value, title: 'Last accepted' };

		gateway.next = { kind: 'accepted', document: accepted };
		expect(await session.addNode(node)).toBe(accepted);
		expect(session.read()).toBe(accepted);
		expect(subscriber).toHaveBeenCalledOnce();
		subscriber.mockClear();
		gateway.next = {
			kind: 'rejected',
			diagnostics: [{ code: 'test-rejected', message: 'rejected', path: [] }],
		};
		await expect(session.addNode(node)).rejects.toThrow('rejected');
		expect(session.read()).toBe(accepted);
		expect(subscriber).not.toHaveBeenCalled();
		gateway.next = {
			kind: 'rolled-back',
			diagnostics: [{ code: 'test-rolled-back', message: 'rolled back', path: [] }],
		};
		await expect(session.addNode(node)).rejects.toThrow('rolled back');
		expect(session.read()).toBe(accepted);
		expect(subscriber).not.toHaveBeenCalled();
		gateway.next = { kind: 'failed', error: new Error('failed') };
		await expect(session.addNode(node)).rejects.toThrow('failed');
		expect(session.read()).toBe(accepted);
		expect(subscriber).not.toHaveBeenCalled();
	});

	it('waits for delayed acceptance before publishing and returning its document', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const gateway = new FakeDocumentCommandGateway(parsed.value);
		const accepted = { ...parsed.value, title: 'Accepted before completion' };
		gateway.next = { kind: 'accepted', document: accepted };
		let complete!: () => void;
		gateway.completion = new Promise((resolve) => {
			complete = resolve;
		});
		const session = new DocumentSession(gateway);

		const pending = session.addNode({ id: 'delayed', natureId: 'goal', markdown: 'Delayed' });

		expect(session.read()).toBe(parsed.value);
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		complete();
		await expect(pending).resolves.toBe(accepted);
		expect(session.read()).toBe(accepted);
	});

	it.each([
		[
			'accepted',
			(document: Awaited<ReturnType<typeof referenceForDelayedTest>>) => ({
				kind: 'accepted',
				document,
			}),
		],
		[
			'rejected',
			() => ({
				kind: 'rejected',
				diagnostics: [{ code: 'delayed-rejection', message: 'rejected', path: [] }],
			}),
		],
		['failed', () => ({ kind: 'failed', error: new Error('failed') })],
	] satisfies readonly (readonly [
		string,
		(document: Awaited<ReturnType<typeof referenceForDelayedTest>>) => DocumentCommandOutcome,
	])[])('rejects a delayed %s completion after destruction', async (_kind, outcome) => {
		const document = await referenceForDelayedTest();
		const gateway = new FakeDocumentCommandGateway(document);
		let complete!: () => void;
		gateway.completion = new Promise((resolve) => {
			complete = resolve;
		});
		gateway.next = outcome(document);
		const session = new DocumentSession(gateway);
		const pending = session.addNode({ id: 'delayed', natureId: 'goal', markdown: 'Delayed' });

		session.destroy();
		complete();

		await expect(pending).rejects.toThrow('Document session has been destroyed');
	});

	it('returns a delayed command acknowledgement while following an earlier authoritative publication', async () => {
		const document = await referenceForDelayedTest();
		const gateway = new FakeDocumentCommandGateway(document);
		gateway.publishOnDispatch = false;
		const acknowledged = { ...document, title: 'Correlated command result' };
		const authoritative = { ...document, title: 'Published first' };
		gateway.next = { kind: 'accepted', document: acknowledged };
		let complete!: () => void;
		gateway.completion = new Promise((resolve) => {
			complete = resolve;
		});
		const session = new DocumentSession(gateway);
		const pending = session.addNode({ id: 'pending', natureId: 'goal', markdown: 'Pending' });

		gateway.publish({ kind: 'accepted', document: authoritative });
		expect(session.read()).toBe(authoritative);
		complete();

		await expect(pending).resolves.toBe(acknowledged);
		expect(session.read()).toBe(authoritative);
	});

	it('allows command completion before its independent authoritative publication', async () => {
		const document = await referenceForDelayedTest();
		const gateway = new FakeDocumentCommandGateway(document);
		gateway.publishOnDispatch = false;
		const accepted = { ...document, title: 'Accepted but not published' };
		gateway.next = { kind: 'accepted', document: accepted };
		const session = new DocumentSession(gateway);

		await expect(
			session.addNode({ id: 'pending', natureId: 'goal', markdown: 'Pending' }),
		).resolves.toBe(accepted);
		expect(session.read()).toBe(document);

		gateway.publish();
		expect(session.read()).toBe(accepted);
	});

	it('propagates asynchronous protocol errors without changing accepted state', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const gateway = new FakeDocumentCommandGateway(parsed.value);
		const error = new Error('async protocol failed');
		gateway.dispatchError = error;
		const session = new DocumentSession(gateway);

		await expect(
			session.addNode({ id: 'failed', natureId: 'goal', markdown: 'Failed' }),
		).rejects.toBe(error);
		expect(session.read()).toBe(parsed.value);
	});

	it('tears down its gateway subscription and gateway exactly once', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const gateway = new FakeDocumentCommandGateway(parsed.value);
		const session = new DocumentSession(gateway);

		session.destroy();
		session.destroy();

		expect(gateway.unsubscribeCalls).toBe(1);
		expect(gateway.destroyCalls).toBe(1);
		expect(gateway.subscribers).toHaveLength(0);
	});

	it('isolates session subscribers when a fake gateway publishes', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const gateway = new FakeDocumentCommandGateway(parsed.value);
		const later = vi.fn();
		const session = new DocumentSession(gateway);
		session.subscribe(() => {
			throw new Error('isolated');
		});
		session.subscribe(later);

		await session.addNode({ id: 'test', natureId: 'goal', markdown: 'Test' });

		expect(later).toHaveBeenCalledWith(parsed.value);
	});

	it('serializes publications triggered reentrantly by a subscriber', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const gateway = new FakeDocumentCommandGateway(parsed.value);
		const session = new DocumentSession(gateway);
		const first = { ...parsed.value, title: 'First' };
		const second = { ...parsed.value, title: 'Second' };
		const observed: string[] = [];
		session.subscribe((document) => {
			if (document !== first) return;
			gateway.next = { kind: 'accepted', document: second };
			void session
				.addNode({ id: 'nested', natureId: 'goal', markdown: 'Nested' })
				.catch(() => undefined);
		});
		session.subscribe((document) => observed.push(document.title));
		gateway.next = { kind: 'accepted', document: first };

		await session.addNode({ id: 'outer', natureId: 'goal', markdown: 'Outer' });

		expect(observed).toEqual(['First', 'Second']);
		expect(session.read()).toBe(second);
	});
	it('stops subscriber delivery when a subscriber destroys the session', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const gateway = new FakeDocumentCommandGateway(parsed.value);
		const session = new DocumentSession(gateway);
		const later = vi.fn();
		session.subscribe(() => {
			session.destroy();
		});
		session.subscribe(later);

		await gateway.dispatch();

		expect(later).not.toHaveBeenCalled();
		expect(gateway.destroyCalls).toBe(1);
	});
	it('creates a concrete document session', async () => {
		expect(await createSession()).toBeInstanceOf(DocumentSession);
	});

	it('reads synchronously and notifies subscribers after a successful node transaction', async () => {
		const session = await createSession();
		const subscriber = vi.fn();
		session.subscribe(subscriber);

		const added = await session.addNode({
			id: 'new-goal',
			natureId: 'goal',
			markdown: 'New goal',
		});

		expect(session.read()).toEqual(added);
		const addedNode = added.nodes.find(({ id }) => id === 'new-goal');
		expect(addedNode).toMatchObject({
			kind: EndpointKind.Node,
			id: 'new-goal',
			natureId: 'goal',
			markdown: 'New goal',
		});
		expect(typeof addedNode?.layoutOrder).toBe('string');
		expect(subscriber).toHaveBeenCalledOnce();
		expect(subscriber).toHaveBeenCalledWith(added);
	});

	it('does not notify subscribers when node addition is rejected', async () => {
		const session = await createSession();
		const subscriber = vi.fn();
		session.subscribe(subscriber);

		await expect(
			session.addNode({ id: 'invalid', natureId: 'missing', markdown: 'Invalid' }),
		).rejects.toThrow('Unknown nature: missing');
		expect(subscriber).not.toHaveBeenCalled();
		expect(session.read().nodes).not.toContainEqual(expect.objectContaining({ id: 'invalid' }));
	});

	it('isolates subscriber exceptions, continues notifications, and reports them', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const reporter = vi.fn();
		const session = createDocumentSession(parsed.value, reporter);
		const failure = new Error('subscriber failed');
		const laterSubscriber = vi.fn();
		session.subscribe(() => {
			throw failure;
		});
		session.subscribe(laterSubscriber);

		const added = await session.addNode({
			id: 'isolated',
			natureId: 'goal',
			markdown: 'Isolated',
		});

		expect(laterSubscriber).toHaveBeenCalledWith(added);
		expect(reporter).toHaveBeenCalledWith({ kind: 'subscriber-error', error: failure });
		expect(session.read()).toBe(added);
	});

	it('isolates subscriber and reporter exceptions during external publication', async () => {
		const reporter = vi.fn(() => {
			throw new Error('reporter failed');
		});
		const { session, ydoc } = await createObservableSession(reporter);
		const failure = new Error('subscriber failed');
		const laterSubscriber = vi.fn();
		session.subscribe(() => {
			throw failure;
		});
		session.subscribe(laterSubscriber);
		const markdown = ydoc
			.getMap<Y.Map<unknown>>('sequit.nodes')
			.get('traceable-edits')
			?.get('markdown');
		if (!(markdown instanceof Y.Text)) throw new Error('Expected shared Markdown');

		expect(() => {
			markdown.insert(markdown.length, 'External');
		}).not.toThrow();
		expect(laterSubscriber).toHaveBeenCalledOnce();
		expect(reporter).toHaveBeenCalledWith({ kind: 'subscriber-error', error: failure });
		expect(session.read().nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toContain(
			'External',
		);
	});

	it('notifies subscribers after a successful relation transaction', async () => {
		const session = await createSession();
		const subscriber = vi.fn();
		session.subscribe(subscriber);

		const added = await session.addRelation({
			id: 'new-independent-relation',
			from: 'prompt-management',
			to: 'training-roi',
		});

		expect(added.relations).toContainEqual({
			id: 'new-independent-relation',
			from: 'prompt-management',
			to: 'training-roi',
		});
		expect(subscriber).toHaveBeenCalledOnce();
		expect(subscriber).toHaveBeenCalledWith(added);
	});

	it('retains the last valid publication when a remote merge is invalid', async () => {
		const { session, ydoc } = await createObservableSession();
		const published = session.read();
		const subscriber = vi.fn();
		session.subscribe(subscriber);
		const replica = new Y.Doc();
		Y.applyUpdate(replica, Y.encodeStateAsUpdate(ydoc));
		const replicaState = Y.encodeStateVector(replica);
		replica.getMap('sequit.nodes').delete('traceable-edits');

		Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(replica, replicaState));

		expect(session.read()).toBe(published);
		expect(subscriber).not.toHaveBeenCalled();
	});

	it('reports rejected external transactions separately', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const ydoc = new Y.Doc();
		const reporter = vi.fn();
		importLogicDocument(ydoc, parsed.value);
		const session = attachDocumentSession(ydoc, reporter);

		ydoc.getMap('sequit.nodes').delete('traceable-edits');

		expect(reporter).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'rejected-external-transaction' }),
		);
		expect(session.read().nodes).toContainEqual(expect.objectContaining({ id: 'traceable-edits' }));
	});

	it('rejects a local command when the backing Yjs document is already invalid', async () => {
		const reporter = vi.fn();
		const { session, ydoc } = await createObservableSession(reporter);
		ydoc.getMap('sequit.nodes').delete('traceable-edits');
		reporter.mockClear();

		await expect(
			session.addNode({ id: 'must-not-be-accepted', natureId: 'goal', markdown: 'Invalid base' }),
		).rejects.toThrow(DocumentSessionError);
		expect(ydoc.getMap('sequit.nodes').has('must-not-be-accepted')).toBe(false);
		expect(reporter).not.toHaveBeenCalled();
	});

	it('rejects the actual live materialization poisoned after detached preflight', async () => {
		const reporter = vi.fn<DocumentSessionErrorReporter>();
		const { session, ydoc } = await createObservableSession(reporter);
		const accepted = session.read();
		const subscriber = vi.fn();
		session.subscribe(subscriber);
		let poison = true;
		ydoc.on('beforeTransaction', () => {
			if (!poison) return;
			poison = false;
			ydoc.getMap('sequit.nodes').delete('traceable-edits');
		});

		await expect(
			session.addNode({ id: 'poisoned-addition', natureId: 'goal', markdown: 'Poisoned' }),
		).rejects.toThrow(DocumentSessionError);
		expect(subscriber).not.toHaveBeenCalled();
		expect(reporter).not.toHaveBeenCalled();
		expect(session.read()).toBe(accepted);
		expect(ydoc.getMap('sequit.nodes').has('traceable-edits')).toBe(false);
		expect(ydoc.getMap('sequit.nodes').has('poisoned-addition')).toBe(false);
	});

	it('preserves structured diagnostics reported for invalid external materialization', async () => {
		const reporter = vi.fn<DocumentSessionErrorReporter>();
		const { ydoc } = await createObservableSession(reporter);

		ydoc.getMap('sequit.nodes').delete('traceable-edits');

		const firstCall = reporter.mock.calls[0];
		if (firstCall === undefined) throw new Error('Expected a reported rejection');
		const report = firstCall[0];
		expect(report).toMatchObject({ kind: 'rejected-external-transaction' });
		if (report.kind !== DocumentSessionErrorKind.RejectedExternalTransaction) {
			throw new Error('Expected rejection');
		}
		expect(report.diagnostics[0]?.code).toBe('invalid-yjs-live-document');
		expect(Array.isArray(report.diagnostics[0]?.path)).toBe(true);
	});

	it('attaches to a populated injected document without replacing it', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, { ...parsed.value, title: 'Already shared' });

		const session = attachDocumentSession(ydoc);

		expect(session.read().title).toBe('Already shared');
		expect(ydoc.getMap('sequit.meta').get('title')).toBe('Already shared');
	});

	it('does not destroy an injected document during teardown', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, parsed.value);
		const destroy = vi.spyOn(ydoc, 'destroy');
		const session = attachDocumentSession(ydoc);

		session.destroy();

		expect(destroy).not.toHaveBeenCalled();
	});

	it('rejects an invalid initial document before importing it', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const invalid = { ...parsed.value, natures: [] };

		expect(() => createDocumentSession(invalid)).toThrow('Unknown nature');
	});

	it('rejects a cyclic initial document before publication', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const relation = parsed.value.relations[0];
		if (relation === undefined) throw new Error('Expected a reference relation');
		const cyclic = {
			...parsed.value,
			relations: [
				...parsed.value.relations,
				{ id: 'reverse-first-relation', from: relation.to, to: relation.from },
			],
		};

		expect(() => createDocumentSession(cyclic)).toThrow('Cycle detected');
	});

	it('rejects a Y.Doc passed in the reporter position and cleans up failed owned documents', async () => {
		const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
		if (!parsed.ok) throw new Error('Reference document must parse');
		const injected = new Y.Doc();
		expect(() => {
			// @ts-expect-error Deliberately exercise the legacy invalid argument position.
			createDocumentSession(parsed.value, injected);
		}).toThrow('use attachDocumentSession');

		const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');
		try {
			expect(() => createDocumentSession({ ...parsed.value, natures: [] })).toThrow(
				'Unknown nature',
			);
			expect(destroy).toHaveBeenCalledOnce();
		} finally {
			destroy.mockRestore();
			injected.destroy();
		}
	});

	it('does not let a sequit-prefixed string forge a session-owned origin', async () => {
		const { session, ydoc } = await createObservableSession();
		const subscriber = vi.fn();
		session.subscribe(subscriber);
		const markdown = ydoc
			.getMap<Y.Map<unknown>>('sequit.nodes')
			.get('traceable-edits')
			?.get('markdown');
		if (!(markdown instanceof Y.Text)) throw new Error('Expected shared Markdown');

		ydoc.transact(() => {
			markdown.insert(markdown.length, 'External');
		}, 'sequit:forged');

		expect(subscriber).toHaveBeenCalledOnce();
	});

	it('publishes a valid remote transaction exactly once', async () => {
		const { session, ydoc } = await createObservableSession();
		const subscriber = vi.fn();
		session.subscribe(subscriber);
		const markdown = ydoc
			.getMap<Y.Map<unknown>>('sequit.nodes')
			.get('traceable-edits')
			?.get('markdown');
		if (!(markdown instanceof Y.Text)) throw new Error('Expected shared Markdown');

		ydoc.transact(() => {
			markdown.insert(markdown.length, 'Remote');
		}, 'remote-provider');

		expect(subscriber).toHaveBeenCalledOnce();
		expect(session.read().nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toContain(
			'Remote',
		);
	});

	it('rejects reads, additions, and subscriptions after destroy', async () => {
		const session = await createSession();
		session.destroy();

		expect(() => session.read()).toThrow(DocumentSessionError);
		await expect(
			session.addNode({ id: 'late', natureId: 'goal', markdown: 'Late' }),
		).rejects.toThrow('Document session has been destroyed');
		await expect(session.addRelation({ id: 'late', from: 'source', to: 'target' })).rejects.toThrow(
			'Document session has been destroyed',
		);
		expect(() => session.subscribe(() => undefined)).toThrow('Document session has been destroyed');
	});
});
