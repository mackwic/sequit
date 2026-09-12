import { importOf, memberName, phaseOf, unwrap, variableOf } from '../visual-scenario-ast.js';

function observedLayout(context, expression, phase, visited = new Set()) {
	const node = unwrap(expression);
	const origin = importOf(context, node);
	if (origin && /\/harnesses\/(layout-nodes|visual-layout)(?:\.ts)?$/.test(origin.source))
		return true;
	if (node?.type !== 'Identifier') return false;
	const variable = variableOf(context, node);
	if (!variable || visited.has(variable)) return false;
	visited.add(variable);
	const parameter = phase?.node.params[0];
	if (
		phase?.name === 'assert' &&
		parameter?.type === 'Identifier' &&
		variableOf(context, parameter) === variable
	)
		return true;
	const definition = variable.defs[0];
	return (
		definition?.type === 'Variable' &&
		definition.parent.kind === 'const' &&
		observedLayout(context, definition.node.init, phase, visited)
	);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			prepare:
				'Prepare data and run the layout harness in arrange(direction, bias), not in assert. assert must only observe and verify the result.',
			verify:
				'Verify properties in assert(layout), not in arrange. Preparation must return the real layout before assertions run.',
			geometry:
				'Do not construct or replace observed geometry in a visual scenario. Use the layout harness in arrange; synthetic geometry belongs in assertion counterexample tests.',
		},
	},
	create(context) {
		function check(node) {
			const phase = phaseOf(context, node);
			const origin = importOf(context, node.callee);
			const callee = node.callee;
			if (
				callee.type === 'MemberExpression' &&
				['withElements', 'withRelations'].includes(memberName(callee)) &&
				observedLayout(context, callee.object, phase)
			) {
				context.report({ node, messageId: 'geometry' });
				return;
			}
			if (!origin) return;
			if (
				/\/harnesses\/visual-layout(?:\.ts)?$/.test(origin.source) &&
				origin.name === 'VisualLayout'
			) {
				context.report({ node, messageId: 'geometry' });
				return;
			}
			// Report a fluent chain once, on the outer call that expresses the operation.
			if (
				node.parent?.type === 'MemberExpression' &&
				node.parent.object === node &&
				node.parent.parent?.type === 'CallExpression'
			)
				return;
			const prepares =
				/\/(builders|fixtures)\//.test(origin.source) ||
				/\/harnesses\/layout-nodes(?:\.ts)?$/.test(origin.source);
			const verifies =
				/\/assertions\//.test(origin.source) &&
				(origin.name?.startsWith('Assert') ||
					['equalMetric', 'minimumMetric'].includes(origin.name));
			if (prepares && phase?.name === 'assert') context.report({ node, messageId: 'prepare' });
			if (verifies && phase?.name === 'arrange') context.report({ node, messageId: 'verify' });
		}
		return { CallExpression: check, NewExpression: check };
	},
};
