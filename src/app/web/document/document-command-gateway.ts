import type { LogicDocument } from '../../../lib/core/document/logic-document';
import {
	projectNodeAddition,
	projectRelationAddition,
} from '../../../lib/core/document/topology-edits';
import { fractionalOrderKeySpace } from '../../../lib/core/ordering/order-key-space';
import {
	type AcceptedCommandOutcome,
	type DocumentChangeRepository,
	type DocumentCommand,
	DocumentCommandDiagnosticCode,
	type DocumentCommandGateway,
	DocumentCommandKind,
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
	type DocumentCommandProjectionResult,
	DocumentCommandPublicationMode,
	type FailedCommandOutcome,
	type LocalDocumentCommandGatewayOptions,
} from '../../../lib/infrastructure/document/document-command-contracts';

function assertNever(value: never): never {
	throw new TypeError(`Unsupported document command: ${String(value)}`);
}

function projectNodeMarkdownReplacement(
	document: LogicDocument,
	nodeId: string,
	markdown: string,
): DocumentCommandProjectionResult {
	const node = document.nodes.find(({ id }) => id === nodeId);
	if (node === undefined) {
		return {
			ok: false,
			diagnostics: [
				{
					code: DocumentCommandDiagnosticCode.NodeNotFound,
					message: `Node no longer exists: ${nodeId}`,
					path: ['nodes', nodeId],
				},
			],
		};
	}
	return {
		ok: true,
		value: {
			changes: {
				nodeAdditions: [],
				relationAdditions: [],
				endpointOrderChanges: [],
				nodeMarkdownReplacements: [{ nodeId, markdown }],
			},
		},
	};
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
					case DocumentCommandKind.ReplaceNodeMarkdown:
						return projectNodeMarkdownReplacement(this.current(), command.nodeId, command.markdown);
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

	async #execute(project: () => DocumentCommandProjectionResult): Promise<DocumentCommandOutcome> {
		let projected: DocumentCommandProjectionResult;
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
