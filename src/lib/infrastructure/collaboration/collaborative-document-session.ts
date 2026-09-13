import type { LogicDocument } from '../../core/document/logic-document';
import type { CollaborationTransport } from './collaboration-transport';
import type { CollaborativeDocumentSession } from './collaborative-document-session-types';
import { CollaborativeSession } from './collaborative-session';

export {
	CollaborationStatus,
	type CollaborativeDocumentSession,
} from './collaborative-document-session-types';

export function createCollaborativeDocumentSession(
	initialDocument: LogicDocument,
	transport: CollaborationTransport,
): CollaborativeDocumentSession {
	return new CollaborativeSession(initialDocument, transport);
}
