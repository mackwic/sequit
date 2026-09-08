import type { LogicDocument } from '../../core/document/logic-document';
import type { LogicGraph } from '../../core/graph/create-graph';
import type { ProtocolDiagnostic } from './protocol';

export interface UpdateGuardContext {
	readonly proposalId: string;
	readonly acceptedDocument: LogicDocument;
	readonly candidateDocument: LogicDocument;
	readonly candidateGraph: LogicGraph;
}

interface UpdateGuardApproval {
	readonly ok: true;
}

interface UpdateGuardRejection {
	readonly ok: false;
	readonly diagnostics: readonly ProtocolDiagnostic[];
}

export type UpdateGuardResult = UpdateGuardApproval | UpdateGuardRejection;

export enum UpdateGuardDiagnosticCode {
	DocumentIdentityChanged = 'document-identity-changed',
}

export interface UpdateGuard {
	readonly name: string;
	evaluate(context: UpdateGuardContext): UpdateGuardResult | Promise<UpdateGuardResult>;
}

export const documentIdentityGuard: UpdateGuard = {
	name: 'document-identity',
	evaluate({ acceptedDocument, candidateDocument }): UpdateGuardResult {
		if (acceptedDocument.id === candidateDocument.id) return { ok: true };
		return {
			ok: false,
			diagnostics: [
				{
					code: UpdateGuardDiagnosticCode.DocumentIdentityChanged,
					message: `Document id must remain ${acceptedDocument.id}`,
					path: ['document', 'id'],
				},
			],
		};
	},
};

export const defaultUpdateGuards: readonly UpdateGuard[] = [documentIdentityGuard];

export async function runUpdateGuards(
	guards: readonly UpdateGuard[],
	context: UpdateGuardContext,
): Promise<UpdateGuardResult> {
	for (const guard of guards) {
		const result = await guard.evaluate(context);
		if (!result.ok) return result;
	}
	return { ok: true };
}
