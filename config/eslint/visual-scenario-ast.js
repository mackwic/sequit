const wrappers = new Set([
	'AwaitExpression',
	'ChainExpression',
	'TSAsExpression',
	'TSNonNullExpression',
	'TSSatisfiesExpression',
	'TSTypeAssertion',
]);
const selections = new Set([
	'node',
	'nodes',
	'envelope',
	'route',
	'routes',
	'renderedPaths',
	'quays',
	'rails',
	'trunks',
]);

export function unwrap(node) {
	let current = node;
	while (current && wrappers.has(current.type)) current = current.expression;
	return current;
}

export function variableOf(context, node) {
	let scope = context.sourceCode.getScope(node);
	while (scope) {
		const variable = scope.set.get(node.name);
		if (variable) return variable;
		scope = scope.upper;
	}
	return undefined;
}

export function memberName(node) {
	if (!node.computed && node.property.type === 'Identifier') return node.property.name;
	if (node.computed && node.property.type === 'Literal') return node.property.value;
	return undefined;
}

/** Track bindings, rather than assuming a variable is called `check` or `AssertLayout`. */
export function kindOf(context, expression, visited = new Set()) {
	const node = unwrap(expression);
	if (!node) return undefined;
	if (node.type === 'Identifier') {
		const variable = variableOf(context, node);
		if (!variable || visited.has(variable)) return undefined;
		visited.add(variable);
		const definition = variable.defs[0];
		if (definition?.type === 'ImportBinding') {
			const specifier = definition.node;
			if (!/\/assert-layout(?:\.ts)?$/.test(definition.parent.source.value)) return undefined;
			if (specifier.type === 'ImportNamespaceSpecifier') return 'namespace';
			if (
				specifier.type === 'ImportSpecifier' &&
				(specifier.imported.name ?? specifier.imported.value) === 'AssertLayout'
			)
				return 'factory';
		}
		if (
			definition?.type === 'Variable' &&
			definition.parent.kind === 'const' &&
			definition.node.id.type === 'Identifier'
		) {
			return kindOf(context, definition.node.init, visited);
		}
	}
	if (
		node.type === 'MemberExpression' &&
		kindOf(context, node.object, visited) === 'namespace' &&
		memberName(node) === 'AssertLayout'
	)
		return 'factory';
	if (node.type !== 'CallExpression') return undefined;
	if (kindOf(context, node.callee, new Set(visited)) === 'factory') return 'facade';
	const callee = unwrap(node.callee);
	if (
		callee.type === 'MemberExpression' &&
		selections.has(memberName(callee)) &&
		kindOf(context, callee.object, visited) === 'facade'
	)
		return 'selection';
	if (
		callee.type === 'MemberExpression' &&
		/^(is|are|has|have|follow)[A-Z]/.test(memberName(callee) ?? '')
	) {
		const subject = kindOf(context, callee.object, new Set(visited));
		if (subject === 'selection' || subject === 'assertion') return 'assertion';
	}
	return undefined;
}

export function propertyName(node) {
	if (node?.type !== 'Property') return undefined;
	if (!node.computed && node.key.type === 'Identifier') return node.key.name;
	return node.key.value;
}

export function functionPhase(context, node) {
	const direct = propertyName(node.parent);
	if (direct === 'assert' || direct === 'arrange') return direct;
	let declaration = node;
	if (node.parent?.type === 'VariableDeclarator') declaration = node.parent;
	for (const variable of context.sourceCode.getDeclaredVariables(declaration)) {
		for (const reference of variable.references) {
			const name = propertyName(reference.identifier.parent);
			if (name === 'assert' || name === 'arrange') return name;
		}
	}
	return undefined;
}

export function phaseOf(context, node) {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (
			!['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(
				parent.type,
			)
		)
			continue;
		const name = functionPhase(context, parent);
		if (name) return { name, node: parent };
	}
	return undefined;
}

/** Resolve const aliases and imported namespace members without matching local variable names. */
export function importOf(context, expression, visited = new Set()) {
	const node = unwrap(expression);
	if (!node) return undefined;
	if (node.type === 'CallExpression' || node.type === 'NewExpression')
		return importOf(context, node.callee, visited);
	if (node.type === 'MemberExpression') {
		const origin = importOf(context, node.object, visited);
		if (origin?.name === '*') return { ...origin, name: memberName(node) };
		return origin;
	}
	if (node.type !== 'Identifier') return undefined;
	const variable = variableOf(context, node);
	if (!variable || visited.has(variable)) return undefined;
	visited.add(variable);
	const definition = variable.defs[0];
	if (definition?.type === 'ImportBinding') {
		const specifier = definition.node;
		let name = '*';
		if (specifier.type === 'ImportSpecifier')
			name = specifier.imported.name ?? specifier.imported.value;
		if (specifier.type === 'ImportDefaultSpecifier') name = 'default';
		return { source: definition.parent.source.value, name };
	}
	if (definition?.type === 'Variable' && definition.parent.kind === 'const')
		return importOf(context, definition.node.init, visited);
	return undefined;
}
