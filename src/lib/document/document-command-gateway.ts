import { fractionalOrderKeySpace } from '../layout/order-key-space';
import type { LogicDocument, LogicRelation, NewLogicNode } from './logic-document';
import {
	type DocumentChangeSet,
	projectNodeAddition,
	projectRelationAddition,
} from './topology-edits';

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

export enum DocumentCommandOutcomeKind {
	Accepted = 'accepted',
	Rejected = 'rejected',
	RolledBack = 'rolled-back',
	Failed = 'failed',
}
interface AcceptedCommandOutcome {
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
interface FailedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Failed;
	readonly error: unknown;
}
export type DocumentCommandOutcome =
	AcceptedCommandOutcome | RejectedCommandOutcome | RolledBackCommandOutcome | FailedCommandOutcome;

export enum DocumentCommandKind {
	AddNode = 'add-node',
	AddRelation = 'add-relation',
}
interface AddNodeCommand {
	readonly kind: DocumentCommandKind.AddNode;
	readonly node: NewLogicNode;
}
interface AddRelationCommand {
	readonly kind: DocumentCommandKind.AddRelation;
	readonly relation: LogicRelation;
}
export type DocumentCommand = AddNodeCommand | AddRelationCommand;

interface DocumentChangeSuccess {
	readonly ok: true;
	readonly value: LogicDocument;
}
interface DocumentChangeFailure {
	readonly ok: false;
	readonly diagnostics: readonly DocumentCommandDiagnostic[];
}
type DocumentChangeResult = DocumentChangeSuccess | DocumentChangeFailure;

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

function assertNever(value: never): never {
	throw new TypeError(`Unsupported document command: ${String(value)}`);
}

export class LocalDocumentCommandGateway implements DocumentCommandGateway {
	readonly #subscribers = new Set<(outcome: DocumentCommandOutcome) => void>();
	#dispatchQueue: Promise<void> = Promise.resolve();
	#destroyed = false;

	constructor(
		private readonly current: () => LogicDocument,
		private readonly repository: DocumentChangeRepository,
		private readonly origin?: unknown,
		private readonly options: LocalDocumentCommandGatewayOptions = {},
	) {}

	readAccepted(): LogicDocument {
		return this.current();
	}

	subscribe(subscriber: (outcome: DocumentCommandOutcome) => void): () => void {
		if (this.#destroyed) throw new Error('Document command gateway has been destroyed');
		this.#subscribers.add(subscriber);
		return () => this.#subscribers.delete(subscriber);
	}

	destroy(): void {
		this.#destroyed = true;
		this.#subscribers.clear();
	}

	dispatch(command: DocumentCommand): Promise<DocumentCommandOutcome> {
		const execution = this.#dispatchQueue.then(() => {
			if (this.#destroyed) {
				const failure: FailedCommandOutcome = {
					kind: DocumentCommandOutcomeKind.Failed,
					error: new Error('Document command gateway has been destroyed'),
				};
				return failure;
			}
			return this.#execute(() => {
				switch (command.kind) {
					case DocumentCommandKind.AddNode:
						return projectNodeAddition(this.current(), command.node, fractionalOrderKeySpace);
					case DocumentCommandKind.AddRelation:
						return projectRelationAddition(
							this.current(),
							command.relation,
							fractionalOrderKeySpace,
						);
					default:
						return assertNever(command);
				}
			});
		});
		this.#dispatchQueue = execution.then(
			() => undefined,
			() => undefined,
		);
		return execution;
	}

	async #execute(
		project: () => ReturnType<typeof projectNodeAddition>,
	): Promise<DocumentCommandOutcome> {
		let projected: ReturnType<typeof projectNodeAddition>;
		try {
			projected = project();
		} catch (error) {
			return { kind: DocumentCommandOutcomeKind.Failed, error };
		}
		if (!projected.ok)
			return { kind: DocumentCommandOutcomeKind.Rejected, diagnostics: projected.diagnostics };
		try {
			const materialized = await this.repository.persist(projected.value.changes, this.origin);
			if (!materialized.ok)
				return { kind: DocumentCommandOutcomeKind.Rejected, diagnostics: materialized.diagnostics };
			const outcome: AcceptedCommandOutcome = {
				kind: DocumentCommandOutcomeKind.Accepted,
				document: materialized.value,
			};
			const publicationMode = this.options.publicationMode ?? DocumentCommandPublicationMode.Local;
			if (!this.#destroyed && publicationMode === DocumentCommandPublicationMode.Local)
				this.#publish(outcome);
			return outcome;
		} catch (error) {
			return { kind: DocumentCommandOutcomeKind.Failed, error };
		}
	}

	#publish(outcome: AcceptedCommandOutcome): void {
		for (const subscriber of [...this.#subscribers]) {
			try {
				subscriber(outcome);
			} catch (error) {
				this.#reportSubscriberError(error);
			}
		}
	}

	#reportSubscriberError(error: unknown): void {
		try {
			this.options.reportSubscriberError?.(error);
		} catch {
			// Reporting must not affect publication or command acceptance.
		}
	}
}
