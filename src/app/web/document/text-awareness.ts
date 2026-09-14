import * as Y from 'yjs';

import type { ParticipantPresence } from '../../../lib/infrastructure/collaboration/participant-presence';

export interface RemoteTextRange {
	readonly clientId: number;
	readonly name: string;
	readonly color: string;
	readonly anchor: number;
	readonly head: number;
}

export function remoteTextRanges(
	text: Y.Text,
	participants: readonly ParticipantPresence[],
): RemoteTextRange[] {
	const doc = text.doc;
	if (doc === null) return [];
	const ranges: RemoteTextRange[] = [];
	for (const participant of participants) {
		const selection = participant.textSelection;
		if (!selection) continue;
		try {
			const anchor = Y.createAbsolutePositionFromRelativePosition(
				Y.decodeRelativePosition(selection.anchor),
				doc,
			);
			const head = Y.createAbsolutePositionFromRelativePosition(
				Y.decodeRelativePosition(selection.head),
				doc,
			);
			if (anchor?.type !== text || head?.type !== text) continue;
			ranges.push({
				clientId: participant.clientId,
				name: participant.name,
				color: participant.color,
				anchor: anchor.index,
				head: head.index,
			});
		} catch {
			// An unresolvable peer cursor must never interrupt local editing.
		}
	}
	return ranges;
}
