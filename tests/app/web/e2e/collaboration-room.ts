import * as Y from 'yjs';

import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	SessionMessageKind,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	type CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

export async function seedRoom(
	room: string,
	fixture: CollaborativeFixture,
	initialDocument?: LogicDocument,
): Promise<void> {
	const document = new Y.Doc();
	importLogicDocument(document, {
		...(initialDocument ?? collaborativeFixture(fixture, room)),
		id: room,
	});
	const frame = encodeSessionMessage({
		type: SessionMessageKind.Initialize,
		id: 'fixture',
		update: Y.encodeStateAsUpdate(document),
	});
	document.destroy();
	const socket = new WebSocket(`ws://127.0.0.1:8788/collab/${room}`);
	socket.binaryType = 'arraybuffer';
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error('Room initialization timed out'));
		}, 10000);
		socket.addEventListener('open', () => {
			socket.send(frame);
		});
		socket.addEventListener('message', (event) => {
			if (!(event.data instanceof ArrayBuffer)) return;
			const message = decodeSessionMessage(new Uint8Array(event.data));
			if (message.type === SessionMessageKind.Commit) {
				clearTimeout(timer);
				socket.close();
				resolve();
			}
			if (message.type === SessionMessageKind.Reject) {
				clearTimeout(timer);
				socket.close();
				reject(new Error(message.reason.code));
			}
		});
		socket.addEventListener('error', () => {
			clearTimeout(timer);
			reject(new Error('Room connection failed'));
		});
	});
}
