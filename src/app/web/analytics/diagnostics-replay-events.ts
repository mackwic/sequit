import { plainArray, plainRecord } from './diagnostics-data';
import { fullSnapshot, mutation } from './diagnostics-replay-dom';
import { index, mask, number, replayUrl } from './diagnostics-replay-values';

const MOVEMENT_SOURCES = new Set([1, 6, 12]);

function coordinates(value: Record<string, unknown>): Record<string, unknown> | null {
	const id = index(value['id']);
	const x = number(value['x']);
	const y = number(value['y']);
	if (id === undefined) return null;
	if (x === undefined || y === undefined) return null;
	return { id, x, y };
}
function movements(value: unknown): Record<string, unknown>[] | null {
	if (!plainArray(value)) return null;
	const output: Record<string, unknown>[] = [];
	for (const item of value) {
		if (!plainRecord(item)) continue;
		const point = coordinates(item);
		const timeOffset = number(item['timeOffset']);
		if (point !== null && timeOffset !== undefined) output.push({ ...point, timeOffset });
	}
	return output;
}
function incremental(value: unknown): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	if (typeof value['source'] !== 'number') return null;
	if (value['source'] === 0) return mutation(value);
	if (MOVEMENT_SOURCES.has(value['source'])) return movement(value);
	if (value['source'] === 2) return mouse(value);
	if (value['source'] === 3) return scroll(value);
	if (value['source'] === 4) return viewport(value);
	if (value['source'] === 5) return input(value);
	return null;
}
function movement(value: Record<string, unknown>): Record<string, unknown> | null {
	const positions = movements(value['positions']);
	if (positions === null) return null;
	return { source: value['source'], positions };
}
function mouse(value: Record<string, unknown>): Record<string, unknown> | null {
	const interactionType = index(value['type']);
	if (interactionType === undefined || interactionType > 10) return null;
	const point = coordinates(value);
	if (point === null) return null;
	const output: Record<string, unknown> = { source: 2, ...point, type: value['type'] };
	const pointerType = index(value['pointerType']);
	if (pointerType !== undefined && pointerType <= 2) output['pointerType'] = pointerType;
	return output;
}
function scroll(value: Record<string, unknown>): Record<string, unknown> | null {
	const point = coordinates(value);
	if (point === null) return null;
	return { source: 3, ...point };
}
function viewport(value: Record<string, unknown>): Record<string, unknown> | null {
	const width = number(value['width']);
	const height = number(value['height']);
	if (width === undefined || height === undefined) return null;
	return { source: 4, width, height };
}
function input(value: Record<string, unknown>): Record<string, unknown> | null {
	const id = index(value['id']);
	if (id === undefined) return null;
	if (typeof value['text'] !== 'string') return null;
	if (typeof value['isChecked'] !== 'boolean') return null;
	return { source: 5, id, text: mask(value['text']), isChecked: value['isChecked'] };
}
function eventData(
	value: Record<string, unknown>,
	readRoute: () => string | null,
): Record<string, unknown> | null {
	if (value['type'] === 0 || value['type'] === 1) {
		if (plainRecord(value['data'])) return { type: value['type'], data: {} };
		return null;
	}
	if (value['type'] === 2) {
		const data = fullSnapshot(value['data']);
		if (data !== null) return { type: 2, data };
	}
	if (value['type'] === 3) {
		const data = incremental(value['data']);
		if (data !== null) return { type: 3, data };
	}
	if (value['type'] === 4) return meta(value['data'], readRoute);
	return null;
}
function meta(value: unknown, readRoute: () => string | null): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	const href = replayUrl(readRoute);
	const width = number(value['width']);
	const height = number(value['height']);
	if (href === null) return null;
	if (width === undefined || height === undefined) return null;
	return { type: 4, data: { href, width, height } };
}
export function replayEvent(
	value: unknown,
	readRoute: () => string | null,
): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	if (value['cv'] !== undefined) return null;
	if (typeof value['type'] !== 'number') return null;
	const timestamp = number(value['timestamp']);
	if (timestamp === undefined) return null;
	const data = eventData(value, readRoute);
	if (data === null) return null;
	return { ...data, timestamp };
}
