const FUNCTION_EXPRESSION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);
const TYPESCRIPT_WRAPPER_TYPES = new Set([
	'ChainExpression',
	'TSAsExpression',
	'TSInstantiationExpression',
	'TSNonNullExpression',
	'TSSatisfiesExpression',
	'TSTypeAssertion',
]);

function unwrapExpression(expression) {
	let current = expression;
	while (current && TYPESCRIPT_WRAPPER_TYPES.has(current.type)) {
		current = current.expression;
	}
	return current;
}

function countVariableFunctions(declaration) {
	let count = 0;
	for (const declarator of declaration.declarations) {
		if (declarator.id.type !== 'Identifier') continue;
		const expression = unwrapExpression(declarator.init);
		if (expression && FUNCTION_EXPRESSION_TYPES.has(expression.type)) count += 1;
	}
	return count;
}

function topLevelDeclaration(statement) {
	if (
		statement.type === 'ExportNamedDeclaration' ||
		statement.type === 'ExportDefaultDeclaration'
	) {
		return statement.declaration;
	}
	return statement;
}

function countTopLevelFunctions(program) {
	let count = 0;
	for (const statement of program.body) {
		const declaration = topLevelDeclaration(statement);
		if (!declaration) continue;
		if (declaration.type === 'FunctionDeclaration') {
			if (declaration.id) count += 1;
			continue;
		}
		if (declaration.type === 'VariableDeclaration') {
			count += countVariableFunctions(declaration);
		}
	}
	return count;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'limit named top-level functions in a module',
		},
		schema: [{ type: 'integer', minimum: 0 }],
		messages: {
			exceeded:
				'This module has {{ count }} top-level functions. The configured maximum is {{ max }}.',
		},
	},
	create(context) {
		const [max = 15] = context.options;
		return {
			Program(program) {
				const count = countTopLevelFunctions(program);
				if (count > max) {
					context.report({ node: program, messageId: 'exceeded', data: { count, max } });
				}
			},
		};
	},
};

export default rule;
