import {
	type DocumentResult,
	JUNCTION_OPERATORS,
	LAYOUT_BIASES,
	LAYOUT_DIRECTIONS,
	type LayoutBias,
	type LayoutConfiguration,
	layoutConfiguration,
	type LayoutDirection,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNature,
	type LogicNode,
	type LogicRelation,
	type SequitDiagnostic,
	SequitDiagnosticCode,
} from '../document/logic-document';
import { PERSISTENCE_FORMAT } from './persistence-format';

interface MappingContext {
	readonly diagnostics: SequitDiagnostic[];
}

interface GroupMembership {
	readonly groupId: string;
}

type UnknownTable = Record<string, unknown>;

function isTable(value: unknown): value is UnknownTable {
	if (typeof value !== 'object') return false;
	if (value === null) return false;
	return !Array.isArray(value);
}

function table(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): UnknownTable | undefined {
	if (isTable(value)) return value;
	let code = SequitDiagnosticCode.InvalidType;
	if (value === undefined) code = SequitDiagnosticCode.MissingField;
	context.diagnostics.push({
		code,
		message: `${path.join('.')} must be a table`,
		path,
	});
	return undefined;
}

function string(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): string | undefined {
	if (typeof value === 'string') return value;
	let code = SequitDiagnosticCode.InvalidType;
	if (value === undefined) code = SequitDiagnosticCode.MissingField;
	context.diagnostics.push({
		code,
		message: `${path.join('.')} must be a string`,
		path,
	});
	return undefined;
}

function optionalString(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): string | undefined {
	if (value === undefined) return undefined;
	return string(value, path, context);
}

function entries(value: UnknownTable): readonly (readonly [string, unknown])[] {
	return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function optionalGroupMembership(groupId: string | undefined): Partial<GroupMembership> {
	if (groupId === undefined) return {};
	return { groupId };
}

function mapLayoutConfiguration(
	direction: LayoutDirection | undefined,
	bias: LayoutBias | undefined,
	context: MappingContext,
): LayoutConfiguration | undefined {
	if (direction === undefined || bias === undefined) return undefined;
	const layout = layoutConfiguration(direction, bias);
	if (layout) return layout;
	context.diagnostics.push({
		code: SequitDiagnosticCode.InvalidValue,
		message: `Layout bias ${bias} is incompatible with direction ${direction}`,
		path: ['layout', 'bias'],
	});
	return undefined;
}

export function mapSequitDocument(rootValue: unknown): DocumentResult<LogicDocument> {
	const context: MappingContext = { diagnostics: [] };
	const root = table(rootValue, [], context);
	if (!root) return { ok: false, diagnostics: context.diagnostics };

	if (root['persistenceFormat'] !== PERSISTENCE_FORMAT) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.UnsupportedPersistenceFormat,
			message: `Unsupported persistenceFormat: ${String(root['persistenceFormat'])}`,
			path: ['persistenceFormat'],
		});
	}

	const documentTable = table(root['document'], ['document'], context);
	const layoutTable = table(root['layout'], ['layout'], context);
	const natureTable = table(root['natures'], ['natures'], context);
	const groupTable = table(root['groups'], ['groups'], context);
	const nodeTable = table(root['nodes'], ['nodes'], context);
	const junctionTable = table(root['junctions'], ['junctions'], context);
	const relationTable = table(root['relations'], ['relations'], context);

	const id = documentTable && string(documentTable['id'], ['document', 'id'], context);
	const title = documentTable && string(documentTable['title'], ['document', 'title'], context);
	const directionValue =
		layoutTable && string(layoutTable['direction'], ['layout', 'direction'], context);
	const biasValue = layoutTable && string(layoutTable['bias'], ['layout', 'bias'], context);
	const direction = LAYOUT_DIRECTIONS.find((candidate) => candidate === directionValue);
	const bias = LAYOUT_BIASES.find((candidate) => candidate === biasValue);
	if (directionValue !== undefined && direction === undefined) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Unsupported layout direction: ${directionValue}`,
			path: ['layout', 'direction'],
		});
	}
	if (biasValue !== undefined && bias === undefined) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Unsupported layout bias: ${biasValue}`,
			path: ['layout', 'bias'],
		});
	}
	const layout = mapLayoutConfiguration(direction, bias, context);

	const natures: LogicNature[] = [];
	if (natureTable) {
		for (const [natureId, value] of entries(natureTable)) {
			const path = ['natures', natureId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const label = string(entity['label'], [...path, 'label'], context);
			const color = string(entity['color'], [...path, 'color'], context);
			if (label !== undefined && color !== undefined) natures.push({ id: natureId, label, color });
		}
	}

	const groups: LogicGroup[] = [];
	if (groupTable) {
		for (const [groupId, value] of entries(groupTable)) {
			const path = ['groups', groupId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const label = string(entity['label'], [...path, 'label'], context);
			const parentGroupId = optionalString(entity['group'], [...path, 'group'], context);
			if (label !== undefined) {
				groups.push({
					id: groupId,
					label,
					...optionalGroupMembership(parentGroupId),
				});
			}
		}
	}

	const nodes: LogicNode[] = [];
	if (nodeTable) {
		for (const [nodeId, value] of entries(nodeTable)) {
			const path = ['nodes', nodeId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const natureId = string(entity['nature'], [...path, 'nature'], context);
			const groupId = optionalString(entity['group'], [...path, 'group'], context);
			const markdown = string(entity['markdown'], [...path, 'markdown'], context);
			if (natureId !== undefined && markdown !== undefined) {
				nodes.push({
					id: nodeId,
					natureId,
					markdown,
					...optionalGroupMembership(groupId),
				});
			}
		}
	}

	const junctions: LogicJunction[] = [];
	if (junctionTable) {
		for (const [junctionId, value] of entries(junctionTable)) {
			const path = ['junctions', junctionId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const operatorValue = string(entity['operator'], [...path, 'operator'], context);
			const groupId = optionalString(entity['group'], [...path, 'group'], context);
			const operator = JUNCTION_OPERATORS.find((candidate) => candidate === operatorValue);
			if (operatorValue !== undefined && operator === undefined) {
				context.diagnostics.push({
					code: SequitDiagnosticCode.InvalidValue,
					message: `Unsupported junction operator: ${operatorValue}`,
					path: [...path, 'operator'],
				});
			}
			if (operator !== undefined) {
				junctions.push({
					id: junctionId,
					operator,
					...optionalGroupMembership(groupId),
				});
			}
		}
	}

	const relations: LogicRelation[] = [];
	if (relationTable) {
		for (const [relationId, value] of entries(relationTable)) {
			const path = ['relations', relationId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const from = string(entity['from'], [...path, 'from'], context);
			const to = string(entity['to'], [...path, 'to'], context);
			if (from !== undefined && to !== undefined) relations.push({ id: relationId, from, to });
		}
	}

	if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics };
	if (id === undefined || title === undefined) {
		return { ok: false, diagnostics: context.diagnostics };
	}
	if (!layout) return { ok: false, diagnostics: context.diagnostics };

	return {
		ok: true,
		value: {
			id,
			title,
			layout,
			natures,
			groups,
			nodes,
			junctions,
			relations,
		},
	};
}
