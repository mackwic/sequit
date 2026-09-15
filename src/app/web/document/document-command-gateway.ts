import {
	defined,
	EndpointKind,
	type LogicDocument,
	type LogicGroup,
} from '../../../lib/core/document/logic-document';
import { projectDeletion } from '../../../lib/core/document/topology-deletions';
import {
	projectConnectedNodeAddition,
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
import { groupSiblingDocumentNodes } from '../../../lib/infrastructure/document/document-group-operations';

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

function projectNodeGrouping(
	document: LogicDocument,
	group: { readonly id: string; readonly label: string },
	nodeIds: readonly string[],
): DocumentCommandProjectionResult {
	const grouped = groupSiblingDocumentNodes(document, group, new Set(nodeIds));
	const added = defined(
		grouped.groups.find(({ id }) => id === group.id),
		'Le groupe n’a pas été créé.',
	);
	return {
		ok: true,
		value: {
			changes: {
				nodeAdditions: [],
				relationAdditions: [],
				endpointOrderChanges: [],
				nodeMarkdownReplacements: [],
				groupAdditions: [added],
				endpointGroupChanges: nodeIds.map((endpointId) => ({
					endpointKind: EndpointKind.Node,
					endpointId,
					groupId: added.id,
				})),
			},
		},
	};
}

function projectGroupUpdate(
	document: LogicDocument,
	group: LogicGroup,
): DocumentCommandProjectionResult {
	if (!document.groups.some(({ id }) => id === group.id)) {
		return {
			ok: false,
			diagnostics: [
				{
					code: DocumentCommandDiagnosticCode.GroupNotFound,
					message: `Group no longer exists: ${group.id}`,
					path: ['groups', group.id],
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
				nodeMarkdownReplacements: [],
				groupReplacements: [group],
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
					case DocumentCommandKind.UpdateGroup:
						return projectGroupUpdate(this.current(), command.group);
					case DocumentCommandKind.GroupNodes:
						return projectNodeGrouping(this.current(), command.group, command.nodeIds);
					case DocumentCommandKind.DeleteElements:
						return {
							ok: true,
							value: {
								changes: projectDeletion(this.current(), command.endpointIds, command.relationIds),
							},
						};
					case DocumentCommandKind.AddNode:
						return projectNodeAddition(this.current(), command.node, fractionalOrderKeySpace);
					case DocumentCommandKind.AddConnectedNode:
						return projectConnectedNodeAddition(
							this.current(),
							command.node,
							command.relations,
							fractionalOrderKeySpace,
						);
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
