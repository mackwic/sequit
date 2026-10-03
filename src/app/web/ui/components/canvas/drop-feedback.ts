import type { LogicDocument } from '../../../../../lib/core/document/logic-document';
import { TopologyEditDiagnosticCode } from '../../../../../lib/core/document/topology-edit-ordering';
import { projectRelationAddition } from '../../../../../lib/core/document/topology-edits';
import { GraphDiagnosticCode } from '../../../../../lib/core/graph/create-graph';
import { fractionalOrderKeySpace } from '../../../../../lib/core/ordering/order-key-space';
import { bodyMarkdown } from '../../../../../lib/infrastructure/content/body-markdown';
import { m } from '../../../i18n/paraglide/messages';
import { DropKind, type DropPlan, DropRefusal } from '../../canvas/drag-drop';

/** Long box texts are cut so that the label stays beside the pointer. */
const NAME_LENGTH = 32;

/** Why the document would refuse `from → to`, by the check the shared session runs first. */
export function connectionRefusal(
	document: LogicDocument,
	from: string,
	to: string,
): DropRefusal | undefined {
	const relation = { id: crypto.randomUUID(), from, to };
	const projection = projectRelationAddition(document, relation, fractionalOrderKeySpace);
	if (projection.ok) return undefined;
	const codes: readonly string[] = projection.diagnostics.map(({ code }) => code);
	if (codes.includes(TopologyEditDiagnosticCode.DuplicateRelation)) return DropRefusal.Duplicate;
	if (codes.includes(GraphDiagnosticCode.Cycle)) return DropRefusal.Cycle;
	return DropRefusal.Invalid;
}

/** The checks of one drag: the document is read once per target, however long the pointer stays. */
export function connectionChecker(
	read: () => LogicDocument,
): (from: string, to: string) => DropRefusal | undefined {
	const refusals = new Map<string, DropRefusal | undefined>();
	return (from, to) => {
		const key = JSON.stringify([from, to]);
		if (refusals.has(key)) return refusals.get(key);
		const refusal = connectionRefusal(read(), from, to);
		refusals.set(key, refusal);
		return refusal;
	};
}

function shortened(text: string): string {
	const line = text.trim().split('\n')[0]?.trim() ?? '';
	if (line.length <= NAME_LENGTH) return line;
	return `${line.slice(0, NAME_LENGTH - 1).trimEnd()}…`;
}

function nodeName(markdown: string): string {
	return shortened(
		bodyMarkdown(markdown)
			.map(({ text }) => text)
			.join(''),
	);
}

function connectLabel(document: LogicDocument, to: string): string {
	const node = document.nodes.find(({ id }) => id === to);
	if (node !== undefined) return m.canvas_drop_connect({ name: nodeName(node.markdown) });
	const group = document.groups.find(({ id }) => id === to);
	if (group !== undefined) return m.canvas_drop_connect_group({ name: shortened(group.label) });
	return m.canvas_drop_connect_junction();
}

function moveLabel(document: LogicDocument, plan: Extract<DropPlan, { kind: DropKind.Move }>) {
	const several = plan.ids.length > 1;
	if (plan.groupId === undefined) {
		if (several) return m.canvas_drop_root_selection();
		return m.canvas_drop_root();
	}
	const groupId = plan.groupId;
	const name = shortened(document.groups.find(({ id }) => id === groupId)?.label ?? '');
	if (several) return m.canvas_drop_move_selection({ name });
	return m.canvas_drop_move({ name });
}

const REFUSAL_LABELS: Readonly<Record<DropRefusal, () => string>> = {
	[DropRefusal.Cycle]: () => m.canvas_drop_refused_cycle(),
	[DropRefusal.Duplicate]: () => m.canvas_drop_refused_duplicate(),
	[DropRefusal.Descendant]: () => m.canvas_drop_refused_descendant(),
	[DropRefusal.Invalid]: () => m.canvas_drop_refused(),
};

/** What releasing here does, named beside the pointer while dragging. */
export function dropLabel(document: LogicDocument, plan: DropPlan): string {
	if (plan.kind === DropKind.Connect) return connectLabel(document, plan.to);
	if (plan.kind === DropKind.Move) return moveLabel(document, plan);
	return REFUSAL_LABELS[plan.reason]();
}
