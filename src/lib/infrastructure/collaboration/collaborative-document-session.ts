import type { LogicDocument } from '../../core/document/logic-document';
import type { CollaborationTransport } from './collaboration-transport';
import type { CollaborativeDocumentSession } from './collaborative-document-session-types';
import { CollaborativeSession } from './collaborative-session';

export {
	CollaborationStatus,
	type CollaborativeDocumentSession,
	SourceDocumentStateKind,
} from './collaborative-document-session-types';
export { readSourceDocumentState } from './source-document-state';

export function createCollaborativeDocumentSession(
	initialDocument: LogicDocument,
	transport: CollaborationTransport,
): CollaborativeDocumentSession {
	return new CollaborativeSession(initialDocument, transport);
}
