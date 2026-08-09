import type { CollaborationTransport } from '../collaboration/collaboration-transport';
import type { CollaborativeDocumentSession } from './collaborative-document-session-types';
import { CollaborativeSession } from './collaborative-session';
import type { LogicDocument } from './logic-document';

export {
	CollaborationStatus,
	type CollaborativeDocumentSession,
	type ProposalDecision,
	ProposalDecisionKind,
} from './collaborative-document-session-types';
export { CommitApplication, planCommitApplication } from './collaborative-session-model';

export function createCollaborativeDocumentSession(
	initialDocument: LogicDocument,
	transport: CollaborationTransport,
): CollaborativeDocumentSession {
	return new CollaborativeSession(initialDocument, transport);
}
