function isConstAssertion(node) {
	return (
		node?.type === 'TSAsExpression' &&
		node.typeAnnotation.type === 'TSTypeReference' &&
		node.typeAnnotation.typeName.type === 'Identifier' &&
		node.typeAnnotation.typeName.name === 'const'
	);
}

function isStringMember(property) {
	return (
		property.type === 'Property' &&
		property.kind === 'init' &&
		!property.computed &&
		property.value.type === 'Literal' &&
		typeof property.value.value === 'string'
	);
}

function isClosedStringObject(node) {
	return (
		node.type === 'ObjectExpression' &&
		node.properties.length >= 2 &&
		node.properties.every((property) => isStringMember(property))
	);
}

function queriedIdentifier(node) {
	if (node.type !== 'TSTypeQuery' || node.exprName.type !== 'Identifier') return null;
	return node.exprName;
}

function resolveIdentifier(sourceCode, identifier) {
	let scope = sourceCode.getScope(identifier);
	while (scope) {
		const reference = scope.references.find((candidate) => candidate.identifier === identifier);
		if (reference) return reference.resolved;
		scope = scope.upper;
	}
	return null;
}

function derivedDomainVariable(sourceCode, annotation) {
	if (annotation.type !== 'TSIndexedAccessType') return null;
	const objectIdentifier = queriedIdentifier(annotation.objectType);
	if (!objectIdentifier) return null;
	const index = annotation.indexType;
	if (index.type !== 'TSTypeOperator' || index.operator !== 'keyof') return null;
	const indexIdentifier = queriedIdentifier(index.typeAnnotation);
	if (!indexIdentifier) return null;
	const objectVariable = resolveIdentifier(sourceCode, objectIdentifier);
	if (objectVariable !== resolveIdentifier(sourceCode, indexIdentifier)) return null;
	return objectVariable;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'prefer native string enums for closed string domains',
		},
		schema: [],
		messages: {
			closedStringDomain:
				'Replace this closed string-domain object and derived type with a native string enum.',
		},
	},
	create(context) {
		const candidateDeclarators = new WeakMap();
		const derivedAliases = new Set();
		const sourceCode = context.sourceCode;

		return {
			VariableDeclarator(node) {
				if (node.id.type !== 'Identifier' || !isConstAssertion(node.init)) return;
				if (!isClosedStringObject(node.init.expression)) return;
				const variable = sourceCode
					.getDeclaredVariables(node)
					.find((candidate) => candidate.defs.some((definition) => definition.node === node));
				if (variable) candidateDeclarators.set(variable, node);
			},
			TSTypeAliasDeclaration(node) {
				const variable = derivedDomainVariable(sourceCode, node.typeAnnotation);
				if (variable) derivedAliases.add(variable);
			},
			'Program:exit'() {
				for (const variable of derivedAliases) {
					const declarator = candidateDeclarators.get(variable);
					if (declarator) context.report({ node: declarator, messageId: 'closedStringDomain' });
				}
			},
		};
	},
};

export default rule;
