import { expect } from 'vitest';
import * as Y from 'yjs';

import {
	type AcceptedMessage,
	type CollabMessage,
	CollabMessageKind,
	ProposalIntent,
	type RejectedMessage,
} from '../../src/lib/collaboration/protocol';
import { createYjsEntityMap, YjsCollection } from '../../src/lib/collaboration/yjs-document-schema';
import { collaborativeDocument, encodeFullUpdate, proposeChange } from '../builders/collaboration';

export interface CollaborationScenarioClient {
	send(message: CollabMessage): void;
	nextFrame(): Promise<CollabMessage>;
	expectNoFrame(): Promise<void>;
	close(): void;
}

export interface CollaborationScenarioDriver {
	readonly roomId: string;
	connect(): Promise<CollaborationScenarioClient>;
}

export interface CollaborationContractScenario {
	readonly name: string;
	run(driver: CollaborationScenarioDriver): Promise<void>;
}

function proposal(proposalId: string, intent: ProposalIntent, update: Uint8Array): CollabMessage {
	return { type: CollabMessageKind.Proposal, proposalId, intent, update };
}

function syncRequest(doc: Y.Doc, lastCommit = 0): CollabMessage {
	return {
		type: CollabMessageKind.SyncRequest,
		lastCommit,
		stateVector: Y.encodeStateVector(doc),
	};
}

function accepted(message: CollabMessage): AcceptedMessage {
	expect(message.type).toBe(CollabMessageKind.Accepted);
	if (message.type !== CollabMessageKind.Accepted) throw new TypeError('Expected accepted frame');
	return message;
}

function rejected(message: CollabMessage): RejectedMessage {
	expect(message.type).toBe(CollabMessageKind.Rejected);
	if (message.type !== CollabMessageKind.Rejected) throw new TypeError('Expected rejected frame');
	return message;
}

async function initialize(
	driver: CollaborationScenarioDriver,
	clients: readonly CollaborationScenarioClient[],
	proposalId = 'initialize-1',
): Promise<{ readonly doc: Y.Doc; readonly decisions: readonly AcceptedMessage[] }> {
	const doc = new Y.Doc();
	const update = encodeFullUpdate(collaborativeDocument(driver.roomId));
	Y.applyUpdate(doc, update);
	clients[0]?.send(proposal(proposalId, ProposalIntent.Initialize, update));
	const decisions = await Promise.all(
		clients.map(async (client) => accepted(await client.nextFrame())),
	);
	return { doc, decisions };
}

function replaceMarkdown(doc: Y.Doc, nodeId: string, markdown: string): Uint8Array {
	return proposeChange(doc, (candidate) => {
		const node = candidate.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get(nodeId);
		const text = node?.get('markdown');
		if (!(text instanceof Y.Text)) throw new TypeError(`Expected node ${nodeId}`);
		text.delete(0, text.length);
		text.insert(0, markdown);
	});
}

function closeCycle(doc: Y.Doc): Uint8Array {
	return proposeChange(doc, (candidate) => {
		candidate
			.getMap<Y.Map<unknown>>(YjsCollection.Relations)
			.set('cycle', createYjsEntityMap({ from: 'target', to: 'source-a' }));
	});
}

async function firstWriterWins(driver: CollaborationScenarioDriver): Promise<void> {
	const first = await driver.connect();
	const second = await driver.connect();
	first.send(
		proposal(
			'initialize-first',
			ProposalIntent.Initialize,
			encodeFullUpdate(collaborativeDocument(driver.roomId)),
		),
	);
	second.send(
		proposal(
			'initialize-second',
			ProposalIntent.Initialize,
			encodeFullUpdate(collaborativeDocument(driver.roomId)),
		),
	);

	const firstFrame = await first.nextFrame();
	const secondFrame = await second.nextFrame();
	const acceptedFrame = [firstFrame, secondFrame].find(
		(frame) => frame.type === CollabMessageKind.Accepted,
	);
	if (acceptedFrame?.type !== CollabMessageKind.Accepted) throw new TypeError('Expected a winner');
	let losingClient = first;
	let losingProposalId = 'initialize-first';
	if (acceptedFrame.proposalId === 'initialize-first') {
		losingClient = second;
		losingProposalId = 'initialize-second';
	}
	let rejectionFrame: CollabMessage | undefined = [firstFrame, secondFrame].find(
		(frame) => frame.type === CollabMessageKind.Rejected,
	);
	rejectionFrame ??= await losingClient.nextFrame();
	expect(acceptedFrame.commit).toBe(1);
	expect(rejected(rejectionFrame)).toMatchObject({
		proposalId: losingProposalId,
		diagnostics: [{ code: 'room-already-initialized' }],
	});
	first.close();
	second.close();
}

async function initializationVisible(driver: CollaborationScenarioDriver): Promise<void> {
	const first = await driver.connect();
	const { doc } = await initialize(driver, [first]);
	const later = await driver.connect();
	const empty = new Y.Doc();
	later.send(syncRequest(empty));
	const response = await later.nextFrame();
	expect(response.type).toBe(CollabMessageKind.SyncResponse);
	if (response.type !== CollabMessageKind.SyncResponse)
		throw new TypeError('Expected sync response');
	Y.applyUpdate(empty, response.update);
	expect(response.commit).toBe(1);
	expect(Y.encodeStateVector(empty)).toEqual(Y.encodeStateVector(doc));
	doc.destroy();
	empty.destroy();
	first.close();
	later.close();
}

async function validChange(driver: CollaborationScenarioDriver): Promise<void> {
	const first = await driver.connect();
	const second = await driver.connect();
	const { doc } = await initialize(driver, [first, second]);
	const update = replaceMarkdown(doc, 'source-a', 'Authorized change');
	first.send(proposal('change-1', ProposalIntent.Change, update));
	const firstDecision = accepted(await first.nextFrame());
	const secondDecision = accepted(await second.nextFrame());
	expect(firstDecision).toEqual(secondDecision);
	expect(firstDecision).toMatchObject({ proposalId: 'change-1', commit: 2 });
	Y.applyUpdate(doc, firstDecision.update);
	expect(Y.encodeStateVector(doc)).toEqual(firstDecision.stateVector);
	doc.destroy();
	first.close();
	second.close();
}

async function rejectionUntouched(driver: CollaborationScenarioDriver): Promise<void> {
	const proposer = await driver.connect();
	const peer = await driver.connect();
	const { doc } = await initialize(driver, [proposer, peer]);
	proposer.send(proposal('cycle-1', ProposalIntent.Change, closeCycle(doc)));
	expect(rejected(await proposer.nextFrame())).toMatchObject({ diagnostics: [{ code: 'cycle' }] });
	await peer.expectNoFrame();
	const synced = new Y.Doc();
	proposer.send(syncRequest(synced));
	const response = await proposer.nextFrame();
	expect(response).toMatchObject({ type: CollabMessageKind.SyncResponse, commit: 1 });
	if (response.type !== CollabMessageKind.SyncResponse)
		throw new TypeError('Expected sync response');
	Y.applyUpdate(synced, response.update);
	expect(Y.encodeStateVector(synced)).toEqual(Y.encodeStateVector(doc));
	doc.destroy();
	synced.destroy();
	proposer.close();
	peer.close();
}

async function duplicateDelivery(driver: CollaborationScenarioDriver): Promise<void> {
	const proposer = await driver.connect();
	const peer = await driver.connect();
	const { doc } = await initialize(driver, [proposer, peer]);
	const update = replaceMarkdown(doc, 'source-a', 'Only once');
	const message = proposal('duplicate-1', ProposalIntent.Change, update);
	proposer.send(message);
	const original = accepted(await proposer.nextFrame());
	await peer.nextFrame();
	Y.applyUpdate(doc, original.update);
	const stateBeforeDuplicate = Y.encodeStateAsUpdate(doc);
	proposer.send(message);
	const duplicate = accepted(await proposer.nextFrame());
	expect(duplicate).toMatchObject({ proposalId: 'duplicate-1', commit: original.commit });
	Y.applyUpdate(doc, duplicate.update);
	expect(Y.encodeStateAsUpdate(doc)).toEqual(stateBeforeDuplicate);
	await peer.expectNoFrame();
	doc.destroy();
	proposer.close();
	peer.close();
}

async function concurrentProposals(driver: CollaborationScenarioDriver): Promise<void> {
	const first = await driver.connect();
	const second = await driver.connect();
	const { doc } = await initialize(driver, [first, second]);
	first.send(
		proposal('concurrent-a', ProposalIntent.Change, replaceMarkdown(doc, 'source-a', 'A')),
	);
	second.send(
		proposal('concurrent-b', ProposalIntent.Change, replaceMarkdown(doc, 'source-b', 'B')),
	);
	const firstCommits = [accepted(await first.nextFrame()), accepted(await first.nextFrame())];
	const secondCommits = [accepted(await second.nextFrame()), accepted(await second.nextFrame())];
	expect(firstCommits.map(({ commit }) => commit)).toEqual([2, 3]);
	expect(secondCommits).toEqual(firstCommits);
	for (const decision of firstCommits) Y.applyUpdate(doc, decision.update);
	expect(Y.encodeStateVector(doc)).toEqual(firstCommits[1]?.stateVector);
	doc.destroy();
	first.close();
	second.close();
}

async function reconnectCatchUp(driver: CollaborationScenarioDriver): Promise<void> {
	const first = await driver.connect();
	const second = await driver.connect();
	const { doc } = await initialize(driver, [first, second]);
	second.close();
	const oldVector = Y.encodeStateVector(doc);
	first.send(
		proposal('missed-1', ProposalIntent.Change, replaceMarkdown(doc, 'source-a', 'Missed')),
	);
	const decision = accepted(await first.nextFrame());
	const reconnected = await driver.connect();
	reconnected.send({ type: CollabMessageKind.SyncRequest, lastCommit: 1, stateVector: oldVector });
	const response = await reconnected.nextFrame();
	if (response.type !== CollabMessageKind.SyncResponse)
		throw new TypeError('Expected sync response');
	expect(response.commit).toBe(2);
	expect(response.update).toEqual(decision.update);
	Y.applyUpdate(doc, response.update);
	expect(Y.encodeStateVector(doc)).toEqual(response.stateVector);
	doc.destroy();
	first.close();
	reconnected.close();
}

async function changeBeforeInitialization(driver: CollaborationScenarioDriver): Promise<void> {
	const client = await driver.connect();
	client.send(proposal('early-change', ProposalIntent.Change, new Uint8Array()));
	expect(rejected(await client.nextFrame())).toMatchObject({
		diagnostics: [{ code: 'room-not-initialized' }],
	});
	client.close();
}

async function identityMismatch(driver: CollaborationScenarioDriver): Promise<void> {
	const client = await driver.connect();
	client.send(
		proposal(
			'foreign-init',
			ProposalIntent.Initialize,
			encodeFullUpdate(collaborativeDocument('foreign-room')),
		),
	);
	expect(rejected(await client.nextFrame())).toMatchObject({
		diagnostics: [{ code: 'document-room-mismatch' }],
	});
	client.close();
}

async function guardRejection(driver: CollaborationScenarioDriver): Promise<void> {
	const proposer = await driver.connect();
	const peer = await driver.connect();
	const { doc } = await initialize(driver, [proposer, peer]);
	const update = proposeChange(doc, (candidate) => {
		candidate.getMap(YjsCollection.Meta).set('id', 'changed-id');
	});
	proposer.send(proposal('guard-1', ProposalIntent.Change, update));
	expect(rejected(await proposer.nextFrame())).toMatchObject({
		diagnostics: [{ code: 'document-identity-changed' }],
	});
	await peer.expectNoFrame();
	doc.destroy();
	proposer.close();
	peer.close();
}

export const collaborationContractScenarios: readonly CollaborationContractScenario[] = [
	{ name: 'first-writer-wins initialization', run: firstWriterWins },
	{ name: 'initialization is visible to later joiners', run: initializationVisible },
	{ name: 'a valid change is accepted, broadcast, and convergent', run: validChange },
	{
		name: 'a rejection leaves authoritative state untouched and unbroadcast',
		run: rejectionUntouched,
	},
	{ name: 'duplicate delivery re-acknowledges the original commit', run: duplicateDelivery },
	{ name: 'concurrent proposals serialize into ordered commits', run: concurrentProposals },
	{ name: 'reconnect catch-up returns exactly the missing update', run: reconnectCatchUp },
	{ name: 'a change before initialization is rejected', run: changeBeforeInitialization },
	{ name: 'a document and room identity mismatch is rejected', run: identityMismatch },
	{
		name: 'a guard rejection reaches the proposer only, with its diagnostics',
		run: guardRejection,
	},
];
