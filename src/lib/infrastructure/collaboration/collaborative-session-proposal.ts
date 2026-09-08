import * as Y from 'yjs';

import { cloneCollaborativeYDoc } from './collaborative-session-documents';
import type { PendingOperation } from './pending-operations';
import { CollabMessageKind, encodeCollabMessage, ProposalIntent } from './protocol';
import { replaceNodeMarkdown } from './yjs-document-repository';

export interface PreparedProposal {
	readonly frame: Uint8Array;
	readonly operation: PendingOperation;
	readonly proposalId: string;
}

export function prepareProposal(accepted: Y.Doc, operation: PendingOperation): PreparedProposal {
	const proposalId = operation.proposalId ?? crypto.randomUUID();
	const assigned = { ...operation, proposalId };
	const candidate = cloneCollaborativeYDoc(accepted);
	replaceNodeMarkdown(candidate, assigned.nodeId, assigned.markdown);
	const update = Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(accepted));
	candidate.destroy();
	return {
		frame: encodeCollabMessage({
			type: CollabMessageKind.Proposal,
			proposalId,
			intent: ProposalIntent.Change,
			update,
		}),
		operation: assigned,
		proposalId,
	};
}
