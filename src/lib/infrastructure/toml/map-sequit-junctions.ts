import {
	EndpointKind,
	JunctionOperator,
	type LogicJunction,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import {
	entries,
	type MappingContext,
	optionalString,
	requiredLayoutOrder,
	string,
	table,
	type UnknownTable,
} from './map-sequit-fields';

const junctionOperatorByValue: Readonly<Record<string, JunctionOperator>> = {
	[JunctionOperator.Xor]: JunctionOperator.Xor,
	[JunctionOperator.And]: JunctionOperator.And,
	[JunctionOperator.Or]: JunctionOperator.Or,
};

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

export function mapJunctions(
	junctionTable: UnknownTable | undefined,
	context: MappingContext,
): readonly LogicJunction[] {
	const junctions: LogicJunction[] = [];
	if (junctionTable === undefined) return junctions;
	for (const [id, value] of entries(junctionTable)) {
		const path = ['junctions', id] as const;
		const entity = table(value, path, context);
		if (entity === undefined) continue;
		const operator = mapJunctionOperator(entity['operator'], [...path, 'operator'], context);
		const groupId = optionalString(entity['group'], [...path, 'group'], context);
		const laneId = optionalString(entity['lane'], [...path, 'lane'], context);
		const regionId = optionalString(entity['regionId'], [...path, 'regionId'], context);
		const layoutOrder = requiredLayoutOrder(
			entity['layoutOrder'],
			[...path, 'layoutOrder'],
			context,
		);
		if (operator === undefined || layoutOrder === undefined) continue;
		const ownership: { groupId?: string; laneId?: string; regionId?: string } = {};
		if (groupId !== undefined) ownership.groupId = groupId;
		if (laneId !== undefined) ownership.laneId = laneId;
		if (regionId !== undefined) ownership.regionId = regionId;
		junctions.push({ kind: EndpointKind.Junction, id, operator, layoutOrder, ...ownership });
	}
	return junctions;
}
