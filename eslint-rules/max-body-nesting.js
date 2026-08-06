const BODY_NODE_TYPES = [
	'ArrowFunctionExpression',
	'DoWhileStatement',
	'ForInStatement',
	'ForOfStatement',
	'ForStatement',
	'FunctionDeclaration',
	'FunctionExpression',
	'StaticBlock',
	'SwitchStatement',
	'TryStatement',
	'WhileStatement',
	'WithStatement',
];

function isElseIf(node) {
	return node.parent.type === 'IfStatement' && node.parent.alternate === node;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'limit nesting across functions and control-flow bodies',
		},
		schema: [{ type: 'integer', minimum: 1 }],
		messages: {
			exceeded:
				'Bodies are nested {{ depth }} levels deep. The configured maximum is {{ max }}. Extract a function or use a guard clause.',
		},
	},
	create(context) {
		const [max = 4] = context.options;
		let depth = 0;

		function enterBody(node) {
			depth += 1;
			if (depth === max + 1) {
				context.report({ node, messageId: 'exceeded', data: { depth, max } });
			}
		}

		function exitBody() {
			depth -= 1;
		}

		const visitors = {
			IfStatement(node) {
				if (!isElseIf(node)) enterBody(node);
			},
			'IfStatement:exit'(node) {
				if (!isElseIf(node)) exitBody();
			},
		};

		for (const nodeType of BODY_NODE_TYPES) {
			visitors[nodeType] = enterBody;
			visitors[`${nodeType}:exit`] = exitBody;
		}
		return visitors;
	},
};

export default rule;
