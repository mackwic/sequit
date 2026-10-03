import { GroupState, JunctionOperator } from '../../../lib/core/document/logic-document';
import {
	type CopiedGroup,
	type CopiedJunction,
	type CopiedNode,
	type CopiedRelation,
	NODE_CLIPBOARD_PREFIX as PREFIX,
	type NodeClipboard,
	type NodePasteDestination,
} from './node-clipboard-types';

export function isNodeClipboardText(text: string): boolean {
	return text.startsWith(PREFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (value === null) return false;
	if (typeof value !== 'object') return false;
	return !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
	if (value === undefined) return true;
	return typeof value === 'string';
}

function junctionOperator(value: unknown): value is JunctionOperator {
	if (value === JunctionOperator.And) return true;
	if (value === JunctionOperator.Or) return true;
	return value === JunctionOperator.Xor;
}

function groupState(value: unknown): value is GroupState | undefined {
	if (value === undefined) return true;
	if (value === GroupState.Closed) return true;
	return value === GroupState.Expanded;
}

function readCopiedNode(value: unknown): CopiedNode | undefined {
	if (!isRecord(value)) return undefined;
	const id = value['id'];
	const natureId = value['natureId'];
	const markdown = value['markdown'];
	if (typeof id !== 'string') return undefined;
	if (typeof natureId !== 'string') return undefined;
	if (typeof markdown !== 'string') return undefined;
	const fields = ['description', 'color', 'icon', 'groupId', 'laneId', 'regionId'];
	if (fields.some((field) => !optionalString(value[field]))) return undefined;
	const copy: {
		id: string;
		natureId: string;
		markdown: string;
		description?: string;
		color?: string;
		icon?: string;
		groupId?: string;
		laneId?: string;
		regionId?: string;
	} = { id, natureId, markdown };
	if (typeof value['description'] === 'string') copy.description = value['description'];
	if (typeof value['color'] === 'string') copy.color = value['color'];
	if (typeof value['icon'] === 'string') copy.icon = value['icon'];
	if (typeof value['groupId'] === 'string') copy.groupId = value['groupId'];
	if (typeof value['laneId'] === 'string') copy.laneId = value['laneId'];
	if (typeof value['regionId'] === 'string') copy.regionId = value['regionId'];
	return copy;
}

function readPlacement(value: Record<string, unknown>): NodePasteDestination | undefined {
	const fields = ['groupId', 'laneId', 'regionId'];
	if (fields.some((field) => !optionalString(value[field]))) return undefined;
	const result: { groupId?: string; laneId?: string; regionId?: string } = {};
	if (typeof value['groupId'] === 'string') result.groupId = value['groupId'];
	if (typeof value['laneId'] === 'string') result.laneId = value['laneId'];
	if (typeof value['regionId'] === 'string') result.regionId = value['regionId'];
	return result;
}

function readCopiedGroup(value: unknown): CopiedGroup | undefined {
	if (!isRecord(value)) return undefined;
	const id = value['id'];
	const label = value['label'];
	const state = value['state'];
	if (typeof id !== 'string') return undefined;
	if (typeof label !== 'string') return undefined;
	if (!optionalString(value['color'])) return undefined;
	if (!groupState(state)) return undefined;
	const placement = readPlacement(value);
	if (placement === undefined) return undefined;
	const copy: {
		id: string;
		label: string;
		state?: GroupState;
		color?: string;
		groupId?: string;
		laneId?: string;
		regionId?: string;
	} = { id, label, ...placement };
	if (state === GroupState.Closed || state === GroupState.Expanded) copy.state = state;
	if (typeof value['color'] === 'string') copy.color = value['color'];
	return copy;
}

function readCopiedJunction(value: unknown): CopiedJunction | undefined {
	if (!isRecord(value)) return undefined;
	const id = value['id'];
	const operator = value['operator'];
	if (typeof id !== 'string') return undefined;
	if (!junctionOperator(operator)) return undefined;
	const placement = readPlacement(value);
	if (placement === undefined) return undefined;
	return { id, operator, ...placement };
}

function readCopiedRelation(value: unknown): CopiedRelation | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value['id'] !== 'string') return undefined;
	if (typeof value['from'] !== 'string') return undefined;
	if (typeof value['to'] !== 'string') return undefined;
	return { id: value['id'], from: value['from'], to: value['to'] };
}

function readArray<T>(value: unknown, read: (item: unknown) => T | undefined): T[] | undefined {
	if (!isUnknownArray(value)) return undefined;
	const result: T[] = [];
	for (const item of value) {
		const parsed = read(item);
		if (parsed === undefined) return undefined;
		result.push(parsed);
	}
	return result;
}

/** The clipboard is external input, even when it originated in this browser. */
export function parseNodeClipboard(text: string, documentId: string): NodeClipboard | undefined {
	if (!isNodeClipboardText(text)) return undefined;
	let payload: unknown;
	try {
		payload = JSON.parse(text.slice(PREFIX.length));
	} catch {
		return undefined;
	}
	if (!isRecord(payload)) return undefined;
	if (payload['documentId'] !== documentId) return undefined;
	const nodes = readArray(payload['nodes'], readCopiedNode);
	const groups = readArray(payload['groups'], readCopiedGroup);
	const junctions = readArray(payload['junctions'], readCopiedJunction);
	const relations = readArray(payload['relations'], readCopiedRelation);
	if (nodes === undefined || nodes.length === 0) return undefined;
	if (groups === undefined) return undefined;
	if (junctions === undefined) return undefined;
	if (relations === undefined) return undefined;
	const endpoints = [...nodes, ...groups, ...junctions].map(({ id }) => id);
	if (new Set(endpoints).size !== endpoints.length) return undefined;
	if (new Set(relations.map(({ id }) => id)).size !== relations.length) return undefined;
	const endpointIds = new Set(endpoints);
	if (relations.some(({ from }) => !endpointIds.has(from))) return undefined;
	if (relations.some(({ to }) => !endpointIds.has(to))) return undefined;
	return { documentId, nodes, groups, junctions, relations };
}
