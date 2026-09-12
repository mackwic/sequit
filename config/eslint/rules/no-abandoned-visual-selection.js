import { kindOf } from '../visual-scenario-ast.js';

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Require discarded fluent visual selections to perform an assertion.' },
		schema: [],
		messages: {
			abandoned:
				'This visual selection checks no property. Chain an assertion or retain the selection for later use.',
		},
	},
	create(context) {
		return {
			ExpressionStatement(node) {
				const kind = kindOf(context, node.expression);
				if (kind === 'facade' || kind === 'selection')
					context.report({ node, messageId: 'abandoned' });
			},
		};
	},
};
