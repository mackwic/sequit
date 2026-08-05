import { fractionalOrderKeySpace } from '../layout/order-key-space';
import type { LogicDocument, LogicRelation, NewLogicNode } from './logic-document';
import {
	type DocumentChangeSet,
	projectNodeAddition,
	projectRelationAddition,
} from './topology-edits';

export interface DocumentCommandDiagnostic {
	readonly message: string;
	readonly path: readonly string[];
}

export type DocumentCommandOutcome =
	| { readonly kind: 'accepted'; readonly document: LogicDocument }
	| { readonly kind: 'rejected'; readonly diagnostics: readonly DocumentCommandDiagnostic[] }
	| { readonly kind: 'rolled-back'; readonly diagnostics: readonly DocumentCommandDiagnostic[] }
	| { readonly kind: 'failed'; readonly error: unknown };

export interface DocumentCommandGateway {
	readAccepted(): LogicDocument;
	addNode(node: NewLogicNode): DocumentCommandOutcome;
	addRelation(relation: LogicRelation): DocumentCommandOutcome;
	subscribe(subscriber: (outcome: DocumentCommandOutcome) => void): () => void;
	destroy(): void;
}

export interface DocumentChangeRepository {
	persist(changes: DocumentChangeSet, origin?: unknown): void;
}

export class LocalDocumentCommandGateway implements DocumentCommandGateway {
	readonly #subscribers = new Set<(outcome: DocumentCommandOutcome) => void>();

	constructor(
		private readonly current: () => LogicDocument,
		private readonly repository: DocumentChangeRepository,
		private readonly origin?: unknown,
	) {}

	readAccepted(): LogicDocument {
		return this.current();
	}

	subscribe(subscriber: (outcome: DocumentCommandOutcome) => void): () => void {
		this.#subscribers.add(subscriber);
		return () => this.#subscribers.delete(subscriber);
	}

	destroy(): void {
		this.#subscribers.clear();
	}

	addNode(node: NewLogicNode): DocumentCommandOutcome {
		return this.#execute(() => projectNodeAddition(this.current(), node, fractionalOrderKeySpace));
	}

	addRelation(relation: LogicRelation): DocumentCommandOutcome {
		return this.#execute(() =>
			projectRelationAddition(this.current(), relation, fractionalOrderKeySpace),
		);
	}

	#execute(project: () => ReturnType<typeof projectNodeAddition>): DocumentCommandOutcome {
		let projected: ReturnType<typeof projectNodeAddition>;
		try {
			projected = project();
		} catch (error) {
			return { kind: 'failed', error };
		}
		if (!projected.ok) return { kind: 'rejected', diagnostics: projected.diagnostics };
		try {
			this.repository.persist(projected.value.changes, this.origin);
		} catch (error) {
			return { kind: 'failed', error };
		}
		const outcome = { kind: 'accepted', document: projected.value.document } as const;
		for (const subscriber of [...this.#subscribers]) {
			try {
				subscriber(outcome);
			} catch {
				// A command publication must reach every subscriber.
			}
		}
		return outcome;
	}
}
