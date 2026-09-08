import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	type ContentStyle,
	contentStyleFields,
	type DocumentResult,
	EndpointKind,
	JunctionOperator,
	LAYOUT_BIASES,
	LAYOUT_DIRECTIONS,
	type LayoutConfiguration,
	layoutConfiguration,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNature,
	type LogicNode,
	type LogicRelation,
	type OrderKey,
	PERSISTENCE_FORMAT,
	type SequitDiagnostic,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import { parseOrderKey } from '../../core/document/order-key';

interface MappingContext {
	readonly diagnostics: SequitDiagnostic[];
}

type UnknownTable = Record<string, unknown>;

const junctionOperatorByValue: Readonly<Record<string, JunctionOperator>> = {
	[JunctionOperator.Xor]: JunctionOperator.Xor,
};

function isTable(value: unknown): value is UnknownTable {
	if (typeof value !== 'object') return false;
	return value !== null && !Array.isArray(value);
}

function table(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): UnknownTable | undefined {
	if (isTable(value)) return value;
	context.diagnostics.push({
		code: diagnosticCode(value),
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
	context.diagnostics.push({
		code: diagnosticCode(value),
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

function diagnosticCode(value: unknown): SequitDiagnostic['code'] {
	if (value === undefined) return SequitDiagnosticCode.MissingField;
	return SequitDiagnosticCode.InvalidType;
}

function mapContentStyle(
	entity: UnknownTable,
	path: readonly string[],
	context: MappingContext,
): ContentStyle {
	return contentStyleFields(
		optionalString(entity['color'], [...path, 'color'], context),
		optionalString(entity['icon'], [...path, 'icon'], context),
	);
}

function optionalGroupId(groupId: string | undefined): { readonly groupId?: string } {
	if (groupId === undefined) return {};
	return { groupId };
}

function requiredLayoutOrder(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): OrderKey | undefined {
	const key = string(value, path, context);
	if (key === undefined) return undefined;
	const parsed = parseOrderKey(key);
	if (parsed !== undefined) return parsed;
	context.diagnostics.push({
		code: SequitDiagnosticCode.InvalidValue,
		message: `${path.join('.')} must be a valid fractional order key`,
		path,
	});
	return undefined;
}

function mapJunctionOperator(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): JunctionOperator | undefined {
	const operatorValue = string(value, path, context);
	if (operatorValue === undefined) return undefined;
	const operator = junctionOperatorByValue[operatorValue];
	if (operator !== undefined) return operator;
	context.diagnostics.push({
		code: SequitDiagnosticCode.InvalidValue,
		message: `Unsupported junction operator: ${operatorValue}`,
		path,
	});
	return undefined;
}

function entries(value: UnknownTable): readonly (readonly [string, unknown])[] {
	return Object.entries(value).sort(([left], [right]) => compareCanonicalStrings(left, right));
}

function mapLayout(
	value: UnknownTable | undefined,
	context: MappingContext,
): LayoutConfiguration | undefined {
	const directionValue = value && string(value['direction'], ['layout', 'direction'], context);
	const biasValue = value && string(value['bias'], ['layout', 'bias'], context);
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
	let layout: LayoutConfiguration | undefined;
	if (direction !== undefined && bias !== undefined) layout = layoutConfiguration(direction, bias);
	const recognizedLayoutValues = direction !== undefined && bias !== undefined;
	if (recognizedLayoutValues && layout === undefined) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Layout bias ${bias} is incompatible with direction ${direction}`,
			path: ['layout', 'bias'],
		});
	}
	return layout;
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
	const layout = mapLayout(layoutTable, context);

	const natures: LogicNature[] = [];
	if (natureTable) {
		for (const [natureId, value] of entries(natureTable)) {
			const path = ['natures', natureId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const label = string(entity['label'], [...path, 'label'], context);
			const color = string(entity['color'], [...path, 'color'], context);
			const style = mapContentStyle(entity, path, context);
			if (label !== undefined && color !== undefined)
				natures.push({ id: natureId, label, ...style, color });
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
			const layoutOrder = requiredLayoutOrder(
				entity['layoutOrder'],
				[...path, 'layoutOrder'],
				context,
			);
			if (label !== undefined && layoutOrder !== undefined) {
				groups.push({
					kind: EndpointKind.Group,
					id: groupId,
					label,
					...optionalGroupId(parentGroupId),
					layoutOrder,
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
			const style = mapContentStyle(entity, path, context);
			const groupId = optionalString(entity['group'], [...path, 'group'], context);
			const markdown = string(entity['markdown'], [...path, 'markdown'], context);
			const layoutOrder = requiredLayoutOrder(
				entity['layoutOrder'],
				[...path, 'layoutOrder'],
				context,
			);
			const requiredNodeValues = natureId !== undefined && markdown !== undefined;
			if (requiredNodeValues && layoutOrder !== undefined) {
				nodes.push({
					kind: EndpointKind.Node,
					...style,
					id: nodeId,
					natureId,
					...optionalGroupId(groupId),
					markdown,
					layoutOrder,
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
			const operator = mapJunctionOperator(entity['operator'], [...path, 'operator'], context);
			const groupId = optionalString(entity['group'], [...path, 'group'], context);
			const layoutOrder = requiredLayoutOrder(
				entity['layoutOrder'],
				[...path, 'layoutOrder'],
				context,
			);
			if (operator !== undefined && layoutOrder !== undefined) {
				junctions.push({
					kind: EndpointKind.Junction,
					id: junctionId,
					operator,
					...optionalGroupId(groupId),
					layoutOrder,
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

	const hasDiagnostics = context.diagnostics.length > 0;
	const missingDocumentIdentity = id === undefined || title === undefined;
	if (hasDiagnostics || missingDocumentIdentity || !layout) {
		return { ok: false, diagnostics: context.diagnostics };
	}
	return {
		ok: true,
		value: {
			persistenceFormat: PERSISTENCE_FORMAT,
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
