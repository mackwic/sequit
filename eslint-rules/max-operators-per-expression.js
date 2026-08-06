const EXPRESSION_CONTAINER_TYPES = new Set([
	'Identifier',
	'JSXElement',
	'JSXFragment',
	'Literal',
	'MetaProperty',
	'PrivateIdentifier',
	'SpreadElement',
	'Super',
	'TemplateLiteral',
]);

const EXPRESSION_BOUNDARY_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

function isExpressionContainer(node) {
	return (
		!EXPRESSION_BOUNDARY_TYPES.has(node.type) &&
		(node.type.endsWith('Expression') || EXPRESSION_CONTAINER_TYPES.has(node.type))
	);
}

function expressionRoot(node) {
	let root = node;
	while (root.parent && isExpressionContainer(root.parent)) root = root.parent;
	return root;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'limit the number of operators in an expression',
		},
		schema: [{ type: 'integer', minimum: 1 }],
		messages: {
			exceeded:
				'This expression contains {{ count }} operators. The configured maximum is {{ max }}. Extract intermediate values.',
		},
	},
	create(context) {
		const [max = 3] = context.options;
		const counts = new Map();

		function countOperator(node) {
			const root = expressionRoot(node);
			counts.set(root, (counts.get(root) ?? 0) + 1);
		}

		return {
			AssignmentExpression: countOperator,
			BinaryExpression: countOperator,
			ConditionalExpression: countOperator,
			LogicalExpression: countOperator,
			UnaryExpression: countOperator,
			UpdateExpression: countOperator,
			'Program:exit'() {
				for (const [node, count] of counts) {
					if (count > max) {
						context.report({ node, messageId: 'exceeded', data: { count, max } });
					}
				}
			},
		};
	},
};

export default rule;
