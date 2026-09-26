import type { LogicDocument } from '../../../lib/core/document/logic-document';
import { createGraph, type LogicGraph } from '../../../lib/core/graph/create-graph';

export function requireDemoGraph(document: LogicDocument, description: string): LogicGraph {
	const created = createGraph(document);
	if (!created.ok)
		throw new Error(
			`${description} could not be created: ${created.diagnostics.map(({ message }) => message).join('; ')}`,
		);
	return created.value;
}

export function requireSelectedDemoResult<
	Result extends { readonly status: string },
	SelectedStatus extends Result['status'],
>(
	result: Result,
	selectedStatus: SelectedStatus,
	description: string,
): asserts result is Extract<Result, { readonly status: SelectedStatus }> {
	if (result.status !== selectedStatus) throw new Error(`${description} is ${result.status}.`);
}
