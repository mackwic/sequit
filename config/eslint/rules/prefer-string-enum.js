/** @type {import('eslint').Rule.RuleModule} */
const rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'require string enum members instead of string literal types',
		},
		schema: [],
		messages: {
			stringLiteralType: 'Replace this string literal type with a string enum member.',
		},
	},
	create(context) {
		return {
			TSLiteralType(node) {
				const indexedAccess = node.parent;
				const isPropertyIndex =
					indexedAccess.type === 'TSIndexedAccessType' && indexedAccess.indexType === node;
				if (typeof node.literal.value === 'string' && !isPropertyIndex) {
					context.report({ node, messageId: 'stringLiteralType' });
				}
			},
		};
	},
};

export default rule;
