import { phaseOf } from '../visual-scenario-ast.js';

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Keep failures visible in visual scenario assertion callbacks.' },
		schema: [],
		messages: {
			swallowed:
				'Scenario assertions must propagate failures. Remove this catch or unconditionally throw from it.',
		},
	},
	create(context) {
		return {
			CatchClause(node) {
				if (phaseOf(context, node)?.name !== 'assert') return;
				// Only a straight-line catch ending in a throw is accepted. Earlier control flow
				// could return successfully, even when the last statement is a throw.
				const statements = node.body.body;
				const prefix = statements.slice(0, -1);
				const propagates =
					statements.at(-1)?.type === 'ThrowStatement' &&
					prefix.every((statement) =>
						['VariableDeclaration', 'ExpressionStatement', 'EmptyStatement'].includes(
							statement.type,
						),
					);
				if (!propagates) context.report({ node, messageId: 'swallowed' });
			},
		};
	},
};
