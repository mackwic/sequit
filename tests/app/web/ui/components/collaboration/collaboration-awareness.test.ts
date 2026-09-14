import { expect, it, vi } from 'vitest';

import { CollaborationAwareness } from '../../../../../../src/app/web/ui/components/collaboration/collaboration-awareness.svelte';
import { createCollaborativeDocumentSession } from '../../../../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import {
	encodeSessionMessage,
	SessionMessageKind,
} from '../../../../../../src/lib/infrastructure/collaboration/session-wire';
import { SharedElementKind } from '../../../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../../../support/fixtures/collaborative-document';
import { createMemoryTransportPair } from '../../../../../support/harnesses/memory-transport';

it('filters self and prevents closing an old editor from clearing the new editor cursor', () => {
	const pair = createMemoryTransportPair();
	const client = createCollaborativeDocumentSession(
		collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room'),
		pair.client,
	);
	const awareness = new CollaborationAwareness(client);
	const peer = { clientId: 42, name: 'Bob', color: '#123456', selected: [] };
	pair.server.send(
		encodeSessionMessage({
			type: SessionMessageKind.Presence,
			participants: [peer, { ...peer, clientId: client.document.clientID }],
		}),
	);
	expect(awareness.participants).toEqual([peer]);
	const publish = vi.spyOn(client, 'setPresence');
	const first = Symbol('first'),
		second = Symbol('second');
	const selection = {
		target: { kind: SharedElementKind.Node, id: 'A' },
		field: 'markdown',
		anchor: new Uint8Array([1]),
		head: new Uint8Array([2]),
	};
	awareness.textSelection(first, selection);
	awareness.textSelection(second, selection);
	awareness.textSelection(first, null);
	expect(publish).toHaveBeenCalledTimes(2);
	awareness.textSelection(second, null);
	expect(publish).toHaveBeenLastCalledWith({ textSelection: null });
	awareness.destroy();
	client.destroy();
	pair.server.close();
});
