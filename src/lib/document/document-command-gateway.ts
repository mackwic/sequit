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

export type DocumentCommandOutcome =
	| { readonly kind: 'accepted'; readonly document: LogicDocument }
	| { readonly kind: 'rejected'; readonly diagnostics: readonly DocumentCommandDiagnostic[] }
	| { readonly kind: 'rolled-back'; readonly diagnostics: readonly DocumentCommandDiagnostic[] }
	| { readonly kind: 'failed'; readonly error: unknown };

export type DocumentCommand =
	| { readonly kind: 'add-node'; readonly node: NewLogicNode }
	| { readonly kind: 'add-relation'; readonly relation: LogicRelation };

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
	persist(
		changes: DocumentChangeSet,
		origin?: unknown,
	): Promise<
		| { readonly ok: true; readonly value: LogicDocument }
		| { readonly ok: false; readonly diagnostics: readonly DocumentCommandDiagnostic[] }
	>;
}

export interface LocalDocumentCommandGatewayOptions {
	/** Disable when an enclosing gateway owns publication, such as the Yjs observer path. */
	readonly publishAccepted?: boolean;
	/** Receives subscriber exceptions without affecting publication or command acceptance. */
	readonly reportSubscriberError?: (error: unknown) => void;
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
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#subscribers.clear();
	}

	dispatch(command: DocumentCommand): Promise<DocumentCommandOutcome> {
		const execution = this.#dispatchQueue.then(() => {
			if (this.#destroyed) {
				return {
					kind: 'failed' as const,
					error: new Error('Document command gateway has been destroyed'),
				};
			}
			return this.#execute(() => {
				switch (command.kind) {
					case 'add-node':
						return projectNodeAddition(this.current(), command.node, fractionalOrderKeySpace);
					case 'add-relation':
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
			return { kind: 'failed', error };
		}
		if (!projected.ok) return { kind: 'rejected', diagnostics: projected.diagnostics };
		try {
			const materialized = await this.repository.persist(projected.value.changes, this.origin);
			if (!materialized.ok) return { kind: 'rejected', diagnostics: materialized.diagnostics };
			const outcome = { kind: 'accepted', document: materialized.value } as const;
			if (!this.#destroyed && this.options.publishAccepted !== false) {
				for (const subscriber of [...this.#subscribers]) {
					try {
						subscriber(outcome);
					} catch (error) {
						try {
							this.options.reportSubscriberError?.(error);
						} catch {
							// Reporting must not affect publication or command acceptance.
						}
					}
				}
			}
			return outcome;
		} catch (error) {
			return { kind: 'failed', error };
		}
	}
}
