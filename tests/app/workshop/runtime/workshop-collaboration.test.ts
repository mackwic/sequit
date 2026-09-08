import { expect, it, vi } from 'vitest';

import { WorkshopCollaboration } from '../../../../src/app/workshop/runtime/workshop-collaboration';
import { WorkshopTransport } from '../../../../src/app/workshop/runtime/workshop-transport';
import {
	CollaborationStatus,
	type CollaborativeDocumentSession,
	createCollaborativeDocumentSession,
	type ProposalDecision,
	ProposalDecisionKind,
} from '../../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import { DocumentCommandOutcomeKind } from '../../../../src/lib/infrastructure/document/document-command-contracts';
import { collaborativeDocument } from '../../../support/builders/collaboration';
import { CollaborationAuthority } from '../../../support/harnesses/collaboration-authority';
import { createMemoryTransportPair } from '../../../support/harnesses/memory-transport';

it('waits for initialization and actual validation, including offline resume, without polling', async () => {
	const authority = new CollaborationAuthority('workshop-commands');
	const transport = new WorkshopTransport(() => authority.connect());
	const client = createCollaborativeDocumentSession(
		collaborativeDocument(authority.roomId),
		transport,
	);
	const gateway = new WorkshopCollaboration(client, transport);
	const statuses = vi.fn();
	const stop = gateway.subscribeToStatus(statuses);
	try {
		expect(gateway.canPause()).toBe(false);
		expect((await gateway.replaceNodeMarkdown('planifier', 'Too early')).kind).toBe(
			DocumentCommandOutcomeKind.Failed,
		);
		await authority.settle();
		expect(gateway.status()).toBe(CollaborationStatus.Ready);
		expect(statuses).toHaveBeenLastCalledWith(CollaborationStatus.Ready);
		expect(gateway.canPause()).toBe(true);
		const id = client.read().nodes[0]?.id;
		if (id === undefined) throw new Error('Missing fixture node');
		transport.pause();
		expect(statuses).toHaveBeenLastCalledWith(CollaborationStatus.Disconnected);
		const settled = vi.fn();
		const pending = gateway.replaceNodeMarkdown(id, 'Offline work').then(settled);
		await authority.settle();
		expect(settled).not.toHaveBeenCalled();
		expect((await gateway.replaceNodeMarkdown(id, 'Second save')).kind).toBe(
			DocumentCommandOutcomeKind.Failed,
		);
		transport.resume();
		await authority.settle();
		await pending;
		expect(settled).toHaveBeenCalledWith(
			expect.objectContaining({ kind: DocumentCommandOutcomeKind.Accepted }),
		);
		const accepted = authority.readAuthoritative();
		expect(accepted.ok).toBe(true);
		if (accepted.ok)
			expect(accepted.value.nodes.find((node) => node.id === id)?.markdown).toBe('Offline work');
		expect((await gateway.replaceNodeMarkdown('missing', 'Absent')).kind).toBe(
			DocumentCommandOutcomeKind.Failed,
		);
		// A no-op still acknowledges its own command, synchronously.
		expect((await gateway.replaceNodeMarkdown(id, 'Offline work')).kind).toBe(
			DocumentCommandOutcomeKind.Accepted,
		);
	} finally {
		stop();
		gateway.destroy();
	}
	expect((await gateway.replaceNodeMarkdown('gone', 'After destroy')).kind).toBe(
		DocumentCommandOutcomeKind.Failed,
	);
	gateway.destroy();
});

it('keeps rejections as diagnostics, survives thrown commands and settles pending work on disposal', async () => {
	const decisions = new Set<(decision: ProposalDecision) => void>();
	const command = vi.fn(() => true);
	const document = collaborativeDocument('boundary');
	const destroy = vi.fn();
	const client: CollaborativeDocumentSession = {
		read: () => document,
		connectionStatus: () => CollaborationStatus.Ready,
		replaceNodeMarkdown: command,
		subscribe: () => () => undefined,
		subscribeToDecisions: (listener) => {
			decisions.add(listener);
			return () => decisions.delete(listener);
		},
		destroy,
	};
	const transport = new WorkshopTransport(() => createMemoryTransportPair().client);
	const gateway = new WorkshopCollaboration(client, transport);
	const pending = gateway.replaceNodeMarkdown('node', 'Draft');
	const diagnostics = [{ code: 'refused', message: 'Refused', path: [] }];
	for (const listener of decisions)
		listener({ type: ProposalDecisionKind.Rejected, proposalId: 'proposal', diagnostics });
	expect(await pending).toEqual({ kind: DocumentCommandOutcomeKind.Rejected, diagnostics });
	command.mockImplementationOnce(() => {
		throw new Error('Unavailable');
	});
	expect(await gateway.replaceNodeMarkdown('node', 'Retry')).toMatchObject({
		kind: DocumentCommandOutcomeKind.Failed,
		error: new Error('Unavailable'),
	});
	const last = gateway.replaceNodeMarkdown('node', 'Waiting');
	gateway.destroy();
	expect((await last).kind).toBe(DocumentCommandOutcomeKind.Failed);
	expect(decisions.size).toBe(0);
	expect(destroy).toHaveBeenCalledOnce();
	transport.close();
});
