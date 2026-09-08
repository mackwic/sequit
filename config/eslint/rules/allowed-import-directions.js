import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import architecture from '../../dependency-cruiser.cjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const extensions = ['', '.ts', '.svelte.ts', '.svelte', '.js', '/index.ts', '/index.js'];

function matches(pattern, value) {
	if (pattern === undefined) return true;
	const patterns = [].concat(pattern);
	return patterns.some((entry) => new RegExp(entry).test(value));
}

function matchesSide(side, value) {
	return matches(side.path, value) && (side.pathNot === undefined || !matches(side.pathNot, value));
}

function targetOf(specifier, filename) {
	const clean = specifier.split(/[?#]/)[0];
	let target;
	if (clean.startsWith('$lib/')) target = path.resolve(root, 'src/lib', clean.slice(5));
	else if (clean.startsWith('/src/')) target = path.resolve(root, clean.slice(1));
	else if (clean.startsWith('.')) target = path.resolve(path.dirname(filename), clean);
	else if (path.isAbsolute(clean)) target = clean;
	else return { path: `node_modules/${clean}/`, external: true };
	const resolved =
		extensions
			.map((extension) => target + extension)
			.find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile()) ?? target;
	return { path: path.relative(root, resolved).replaceAll('\\', '/'), external: false };
}

function literalValue(node) {
	if (typeof node?.value === 'string') return node.value;
	if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
		return node.quasis[0].value.cooked;
	}
	return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
	meta: {
		type: 'problem',
		docs: { description: 'Enforce the shared architecture policy on imports and re-exports.' },
		schema: [],
		messages: { forbidden: 'Import "{{target}}" is forbidden by architecture rule "{{rule}}".' },
	},
	create(context) {
		const filename = context.physicalFilename;
		const source = path.relative(root, filename).replaceAll('\\', '/');
		const rules = architecture.forbidden.filter(
			(rule) => !rule.to.circular && matchesSide(rule.from, source),
		);
		function check(node) {
			const specifier = literalValue(node);
			if (specifier === undefined) return;
			const target = targetOf(specifier, filename);
			const violation = rules.find((rule) => {
				if (rule.to.dependencyTypes !== undefined && !target.external) return false;
				return matchesSide(rule.to, target.path);
			});
			if (violation !== undefined)
				context.report({
					node,
					messageId: 'forbidden',
					data: { target: specifier, rule: violation.name },
				});
		}
		return {
			ImportDeclaration: (node) => check(node.source),
			ExportNamedDeclaration: (node) => check(node.source),
			ExportAllDeclaration: (node) => check(node.source),
			ImportExpression: (node) => check(node.source),
			TSImportType: (node) => check(node.source),
			TSExternalModuleReference: (node) => check(node.expression),
			CallExpression(node) {
				if (node.callee.type === 'Identifier' && node.callee.name === 'require')
					check(node.arguments[0]);
			},
		};
	},
};

export default rule;
