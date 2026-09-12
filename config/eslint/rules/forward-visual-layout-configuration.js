import { importOf, phaseOf, propertyName, unwrap, variableOf } from '../visual-scenario-ast.js';

function resolve(context, expression, visited = new Set()) {
	const node = unwrap(expression);
	if (node?.type !== 'Identifier') return node;
	const variable = variableOf(context, node);
	if (!variable || visited.has(variable)) return node;
	visited.add(variable);
	const definition = variable.defs[0];
	if (definition?.type === 'Variable' && definition.parent.kind === 'const')
		return resolve(context, definition.node.init, visited);
	return node;
}

function parameter(node) {
	if (node?.type === 'AssignmentPattern') return node.left;
	return node;
}

function option(context, expression, key, visited = new Set()) {
	const node = resolve(context, expression);
	if (node?.type !== 'ObjectExpression' || visited.has(node)) return undefined;
	visited.add(node);
	let value;
	for (const property of node.properties) {
		if (property.type === 'SpreadElement')
			value = option(context, property.argument, key, new Set(visited));
		else if (propertyName(property) === key) value = resolve(context, property.value);
	}
	return value;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			forward:
				'Pass the arrange parameter {{name}} unchanged to layoutNodes. Put direction and bias after fixture spreads so each requested configuration reaches the engine, including reference layouts.',
			phase:
				'Call layoutNodes inside arrange(direction, bias) so the scenario configuration can be verified.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const origin = importOf(context, node.callee);
				if (
					!origin ||
					origin.name !== 'layoutNodes' ||
					!/\/layout-nodes(?:\.ts)?$/.test(origin.source)
				)
					return;
				const phase = phaseOf(context, node);
				if (phase?.name !== 'arrange') {
					context.report({ node, messageId: 'phase' });
					return;
				}
				for (const [index, name] of ['direction', 'bias'].entries()) {
					const expected = parameter(phase.node.params[index]);
					const actual = option(context, node.arguments[0], name);
					if (
						expected?.type !== 'Identifier' ||
						actual?.type !== 'Identifier' ||
						variableOf(context, expected) !== variableOf(context, actual)
					)
						context.report({ node, messageId: 'forward', data: { name } });
				}
			},
		};
	},
};
