import type {
	ReportedBounds,
	ReportedBox,
	ReportedLane,
	ReportedPoint,
	ReportedRelation,
} from './layout-report';

/** Returns the parsed value, or `undefined` when the input does not have the expected shape. */
export type Parse<T> = (value: unknown) => T | undefined;

const MAX_ITEMS = 50_000;
/** Anonymous document identifiers (`e…`) and identifiers absent from the document (`x…`). */
const REPORT_IDENTIFIER = /^[ex]\d+$/;

export function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	if (typeof value !== 'object') return undefined;
	if (value === null || Array.isArray(value)) return undefined;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- A non-array object.
	return value as Readonly<Record<string, unknown>>;
}

export function finite(value: unknown): number | undefined {
	if (typeof value !== 'number') return undefined;
	if (!Number.isFinite(value)) return undefined;
	return value;
}

export function text(maxLength: number): Parse<string> {
	return (value) => {
		if (typeof value !== 'string') return undefined;
		if (value.length > maxLength) return undefined;
		return value;
	};
}

export function identifier(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	if (!REPORT_IDENTIFIER.test(value)) return undefined;
	return value;
}

export function oneOf<T extends string>(values: readonly T[]): Parse<T> {
	return (value) => values.find((candidate) => candidate === value);
}

export function list<T>(parse: Parse<T>): Parse<readonly T[]> {
	return (value) => {
		if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined;
		const parsed: T[] = [];
		for (const item of value) {
			const result = parse(item);
			if (result === undefined) return undefined;
			parsed.push(result);
		}
		return parsed;
	};
}

/** `[identifier, value]` pairs, as a measured map serializes. */
export function entries<T>(parse: Parse<T>): Parse<readonly (readonly [string, T])[]> {
	return list((value) => {
		if (!Array.isArray(value) || value.length !== 2) return undefined;
		const id = identifier(value[0]);
		const parsed = parse(value[1]);
		if (id === undefined || parsed === undefined) return undefined;
		return [id, parsed] as const;
	});
}

/** Finite numeric fields, all required. */
export function numbers<K extends string>(keys: readonly K[]): Parse<Readonly<Record<K, number>>> {
	return (value) => {
		const fields = record(value);
		if (fields === undefined) return undefined;
		const parsed: Partial<Record<K, number>> = {};
		for (const key of keys) {
			const number = finite(fields[key]);
			if (number === undefined) return undefined;
			parsed[key] = number;
		}
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Every key was set.
		return parsed as Readonly<Record<K, number>>;
	};
}

export const bounds: Parse<ReportedBounds> = numbers(['x', 'y', 'width', 'height']);
const point: Parse<ReportedPoint> = numbers(['x', 'y']);

export function box(value: unknown): ReportedBox | undefined {
	const fields = record(value);
	const id = identifier(fields?.['id']);
	const parsed = bounds(fields?.['bounds']);
	if (id === undefined || parsed === undefined) return undefined;
	return { id, bounds: parsed };
}

export function lane(value: unknown): ReportedLane | undefined {
	const parsed = box(value);
	const regionId = record(value)?.['regionId'];
	if (parsed === undefined || regionId === undefined) return parsed;
	const region = identifier(regionId);
	if (region === undefined) return undefined;
	return { ...parsed, regionId: region };
}

export function relation(value: unknown): ReportedRelation | undefined {
	const fields = record(value);
	const [id, from, to] = [fields?.['id'], fields?.['from'], fields?.['to']].map(identifier);
	const points = list(point)(fields?.['points']);
	if (id === undefined || from === undefined) return undefined;
	if (to === undefined || points === undefined) return undefined;
	return { id, from, to, points };
}
