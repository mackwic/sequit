import { importOf, memberName, unwrap, variableOf } from '../visual-scenario-ast.js';

const randomMethods = new Set([
	'randomUUID',
	'getRandomValues',
	'randomBytes',
	'randomInt',
	'randomFill',
	'randomFillSync',
]);
function globalPath(context, expression, visited = new Set()) {
	const node = unwrap(expression);
	if (!node) return undefined;
	if (node.type === 'MemberExpression') {
		const base = globalPath(context, node.object, visited);
		if (base) return `${base}.${memberName(node)}`;
	}
	if (node.type !== 'Identifier') return undefined;
	const variable = variableOf(context, node);
	if (!variable || variable.defs.length === 0) return node.name;
	if (visited.has(variable)) return undefined;
	visited.add(variable);
	const definition = variable.defs[0];
	if (
		definition?.type === 'Variable' &&
		definition.parent.kind === 'const' &&
		definition.node.id.type === 'Identifier'
	)
		return globalPath(context, definition.node.init, visited);
	return undefined;
}
function uncontrolled(path) {
	const clean = path?.replace(/^(globalThis|window|global)\./, '');
	return (
		[
			'Math.random',
			'Date.now',
			'performance.now',
			'process.hrtime',
			'process.hrtime.bigint',
		].includes(clean) ||
		(clean?.startsWith('crypto.') && randomMethods.has(clean.slice(7)))
	);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			uncontrolled:
				'Visual inputs must be deterministic. Use explicit fixed data. If randomness or a clock is needed, discuss it with a human and introduce an instrumented, reproducible source before using it.',
		},
	},
	create(context) {
		function report(node) {
			context.report({ node, messageId: 'uncontrolled' });
		}
		return {
			MemberExpression(node) {
				const origin = importOf(context, node.object);
				if (
					uncontrolled(globalPath(context, node)) ||
					(origin && /^(node:)?crypto$/.test(origin.source) && randomMethods.has(memberName(node)))
				)
					report(node);
			},
			ImportDeclaration(node) {
				if (!/^(node:)?crypto$/.test(node.source.value)) return;
				for (const specifier of node.specifiers)
					if (
						specifier.type === 'ImportSpecifier' &&
						randomMethods.has(specifier.imported.name ?? specifier.imported.value)
					)
						report(specifier);
			},
			VariableDeclarator(node) {
				if (node.id.type !== 'ObjectPattern') return;
				const base = globalPath(context, node.init);
				for (const property of node.id.properties) {
					if (property.type !== 'Property') continue;
					const name = property.key.name ?? property.key.value;
					if (base && uncontrolled(`${base}.${name}`)) report(property);
				}
			},
			CallExpression(node) {
				if (globalPath(context, node.callee)?.replace(/^globalThis\./, '') === 'Date') report(node);
			},
			NewExpression(node) {
				if (
					globalPath(context, node.callee)?.replace(/^globalThis\./, '') === 'Date' &&
					node.arguments.length === 0
				)
					report(node);
			},
		};
	},
};
