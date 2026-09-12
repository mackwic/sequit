import { functionPhase, kindOf, phaseOf } from '../visual-scenario-ast.js';

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			missing:
				'A visual scenario must verify at least one property through AssertLayout inside assert(layout). Creating a selection alone is not an assertion.',
		},
	},
	create(context) {
		const checked = new Set();
		let callbacks = 0;
		function finish(node) {
			if (functionPhase(context, node) !== 'assert') return;
			callbacks += 1;
			if (!checked.has(node)) context.report({ node, messageId: 'missing' });
		}
		return {
			CallExpression(node) {
				const phase = phaseOf(context, node);
				if (phase?.name === 'assert' && kindOf(context, node) === 'assertion')
					checked.add(phase.node);
			},
			'FunctionExpression:exit': finish,
			'ArrowFunctionExpression:exit': finish,
			'FunctionDeclaration:exit': finish,
			'Program:exit'(node) {
				if (callbacks === 0) context.report({ node, messageId: 'missing' });
			},
		};
	},
};
