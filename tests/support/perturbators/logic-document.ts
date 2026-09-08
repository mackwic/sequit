import type { LogicDocument } from '../../../src/lib/core/document/logic-document';

export function withCycle(document: LogicDocument): LogicDocument {
	return {
		...document,
		relations: [
			...document.relations,
			{
				id: 'reduce-documentary-effort-to-ai-content-generation',
				from: 'reduce-documentary-effort',
				to: 'ai-content-generation',
			},
		],
	};
}
