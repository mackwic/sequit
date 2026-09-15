import type {
	LogicDocument,
	LogicGroup,
	LogicRelation,
	NewLogicNode,
} from '../../core/document/logic-document';
import type { DocumentChangeSet } from '../../core/document/topology-edits';

export interface DocumentCommandDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
	readonly expectedOrder?: readonly string[];
	readonly materializedOrder?: readonly string[];
	readonly expectedScore?: number;
	readonly materializedScore?: number;
}

export enum DocumentCommandDiagnosticCode {
	NodeNotFound = 'node-not-found',
	GroupNotFound = 'group-not-found',
	NodeMarkdownUnavailable = 'node-markdown-unavailable',
	SessionClosed = 'document-session-closed',
}

export enum DocumentCommandOutcomeKind {
	Accepted = 'accepted',
	Rejected = 'rejected',
	RolledBack = 'rolled-back',
	Failed = 'failed',
}
export interface AcceptedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Accepted;
	readonly document: LogicDocument;
}
interface RejectedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Rejected;
	readonly diagnostics: readonly DocumentCommandDiagnostic[];
}
interface RolledBackCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.RolledBack;
	readonly diagnostics: readonly DocumentCommandDiagnostic[];
}
export interface FailedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Failed;
	readonly error: unknown;
}
export type DocumentCommandOutcome =
	AcceptedCommandOutcome | RejectedCommandOutcome | RolledBackCommandOutcome | FailedCommandOutcome;

export enum DocumentCommandKind {
	DeleteElements = 'delete-elements',
	AddNode = 'add-node',
	AddConnectedNode = 'add-connected-node',
	AddRelation = 'add-relation',
	ReplaceNodeMarkdown = 'replace-node-markdown',
	GroupNodes = 'group-nodes',
	UpdateGroup = 'update-group',
}
interface AddNodeCommand {
	readonly kind: DocumentCommandKind.AddNode;
	readonly node: NewLogicNode;
}
interface AddConnectedNodeCommand {
	readonly kind: DocumentCommandKind.AddConnectedNode;
	readonly node: NewLogicNode;
	readonly relations: readonly LogicRelation[];
}
interface AddRelationCommand {
	readonly kind: DocumentCommandKind.AddRelation;
	readonly relation: LogicRelation;
}
interface ReplaceNodeMarkdownCommand {
	readonly kind: DocumentCommandKind.ReplaceNodeMarkdown;
	readonly nodeId: string;
	readonly markdown: string;
}
interface DeleteElementsCommand {
	readonly kind: DocumentCommandKind.DeleteElements;
	readonly endpointIds: readonly string[];
	readonly relationIds: readonly string[];
}
interface GroupNodesCommand {
	readonly kind: DocumentCommandKind.GroupNodes;
	readonly group: { readonly id: string; readonly label: string };
	readonly nodeIds: readonly string[];
}
interface UpdateGroupCommand {
	readonly kind: DocumentCommandKind.UpdateGroup;
	readonly group: LogicGroup;
}
export type DocumentCommand =
	| AddNodeCommand
	| AddConnectedNodeCommand
	| AddRelationCommand
	| ReplaceNodeMarkdownCommand
	| DeleteElementsCommand
	| GroupNodesCommand
	| UpdateGroupCommand;

interface DocumentChangeSuccess {
	readonly ok: true;
	readonly value: LogicDocument;
}
interface DocumentChangeFailure {
	readonly ok: false;
	readonly diagnostics: readonly DocumentCommandDiagnostic[];
}
export type DocumentChangeResult = DocumentChangeSuccess | DocumentChangeFailure;

interface DocumentCommandProjection {
	readonly ok: true;
	readonly value: {
		readonly changes: DocumentChangeSet;
	};
}

interface DocumentCommandProjectionFailure {
	readonly ok: false;
	readonly diagnostics: readonly DocumentCommandDiagnostic[];
}

export type DocumentCommandProjectionResult =
	DocumentCommandProjection | DocumentCommandProjectionFailure;

export interface DocumentCommandGateway {
	/**
	 * Publications are authoritative accepted states and must be emitted in authoritative order.
	 * A dispatch result is only the acknowledgement correlated with that command; callers must not
	 * treat it as a publication or use it to order independently received snapshots.
	 */
	readAccepted(): LogicDocument;
	dispatch(command: DocumentCommand): Promise<DocumentCommandOutcome>;
	subscribe(subscriber: (outcome: DocumentCommandOutcome) => void): () => void;
	destroy(): void;
}

export interface DocumentChangeRepository {
	persist(changes: DocumentChangeSet, origin?: unknown): Promise<DocumentChangeResult>;
}

export interface LocalDocumentCommandGatewayOptions {
	readonly publicationMode?: DocumentCommandPublicationMode;
	/** Receives subscriber exceptions without affecting publication or command acceptance. */
	readonly reportSubscriberError?: (error: unknown) => void;
}

export enum DocumentCommandPublicationMode {
	Local = 'local',
	ObserverOwned = 'observer-owned',
}
