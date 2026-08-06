/** @type {import('eslint').Rule.RuleModule} */
const rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'require object type members of unions to be named',
		},
		schema: [],
		messages: {
			anonymousObject:
				'Extract this object type into a named interface before using it in a union.',
		},
	},
	create(context) {
		return {
			TSUnionType(union) {
				for (const member of union.types) {
					if (member.type === 'TSTypeLiteral') {
						context.report({ node: member, messageId: 'anonymousObject' });
					}
				}
			},
		};
	},
};

export default rule;
