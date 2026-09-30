import { defined } from '../../document/logic-document';
import type { RoutingEdge } from '../geometry/routing-edge';
import { routeOwnedChannel } from './channel-routing';
import type { ChannelEndpoint, ChannelRouting, ChannelRun, ChannelWire } from './channel-types';

/**
 * Wires one root layout may remember, counting the routings it reuses from the previous layout
 * and the new ones. Reused routings are always kept; once the generation holds this many wires,
 * new channels are routed normally and not remembered. The largest performance fixture
 * (1000-node `wide-bipartite-layers`) retains at most about 76,000 wires over two layouts, at
 * about 160 bytes per wire.
 */
export const MAX_CHANNEL_ROUTING_GENERATION_WIRES = 200_000;

export interface ChannelRoutingCacheStats {
	/** Remembered channels of the current and previous layouts. */
	readonly entries: number;
	/** Wires of these remembered channels. */
	readonly wires: number;
	readonly hits: number;
	readonly misses: number;
}

/**
 * One column per wire field `routeOwnedChannel` reads: a new `ChannelEndpoint` field fails to
 * compile here and in `SAME_ENDPOINT_COLUMNS` until it is captured and compared.
 */
type EndpointColumns = {
	readonly [Field in keyof ChannelEndpoint]-?: readonly ChannelEndpoint[Field][];
};
type SameColumn = (columns: EndpointColumns, wires: readonly ChannelWire[]) => boolean;

/** Exact positional comparison; `Object.is` distinguishes -0 from 0. */
const SAME_ENDPOINT_COLUMNS: readonly SameColumn[] = Object.values({
	id: (columns, wires) => wires.every(({ id }, index) => columns.id[index] === id),
	source: (columns, wires) =>
		wires.every(({ source }, index) => Object.is(columns.source[index], source)),
	target: (columns, wires) =>
		wires.every(({ target }, index) => Object.is(columns.target[index], target)),
	sharedSource: (columns, wires) =>
		wires.every(({ sharedSource }, index) => columns.sharedSource[index] === sharedSource),
	sharedTarget: (columns, wires) =>
		wires.every(({ sharedTarget }, index) => columns.sharedTarget[index] === sharedTarget),
} satisfies { readonly [Field in keyof ChannelEndpoint]-?: SameColumn });

/**
 * Every `RoutingEdge` field, written out: a new field fails to compile until its replay is
 * decided. `spacing` is the `RAIL_SPACING` constant; if it ever becomes an input, it must join
 * the compared inputs.
 */
type EdgeTemplate = { readonly [Field in keyof RoutingEdge]-?: RoutingEdge[Field] };

/** Key, rail, start, end, remaining and depth of each run, in this order. */
const RUN_FIELDS = 6;

/** A routed channel without object identity: wires by position, runs by capture index. */
interface ChannelTemplate {
	readonly nonInverted: boolean;
	readonly ownerId: string;
	readonly endpoints: EndpointColumns;
	readonly runFields: readonly number[];
	/** `next` of run `i` is `nextRuns[nextOffsets[i]..nextOffsets[i + 1]]`. */
	readonly nextOffsets: readonly number[];
	readonly nextRuns: readonly number[];
	/** Run indices by wire position, -1 when routing left the reference undefined. */
	readonly firsts: readonly number[];
	readonly lasts: readonly number[];
	/** Wire positions and values of the defined split columns. */
	readonly middleWires: readonly number[];
	readonly middles: readonly number[];
	/** `trackByRunKey` entries as key/track pairs, in insertion order. */
	readonly tracks: readonly number[];
	readonly edge: EdgeTemplate;
	readonly railCount: number;
}

function endpointColumns(wires: readonly ChannelWire[]): EndpointColumns {
	return {
		id: wires.map(({ id }) => id),
		source: wires.map(({ source }) => source),
		target: wires.map(({ target }) => target),
		sharedSource: wires.map(({ sharedSource }) => sharedSource),
		sharedTarget: wires.map(({ sharedTarget }) => sharedTarget),
	};
}

function sameInputs(
	template: ChannelTemplate,
	wires: readonly ChannelWire[],
	nonInverted: boolean,
	ownerId: string,
): boolean {
	if (template.nonInverted !== nonInverted || template.ownerId !== ownerId) return false;
	if (template.endpoints.id.length !== wires.length) return false;
	return SAME_ENDPOINT_COLUMNS.every((same) => same(template.endpoints, wires));
}

/** Runs reachable from the wires, numbered on first sight; `next` rows extend the list. */
class RunIndex {
	readonly runs: ChannelRun[] = [];
	readonly #indexByRun = new Map<ChannelRun, number>();

	indexOf(run: ChannelRun | undefined): number {
		if (run === undefined) return -1;
		let index = this.#indexByRun.get(run);
		if (index === undefined) {
			index = this.runs.length;
			this.#indexByRun.set(run, index);
			this.runs.push(run);
		}
		return index;
	}
}

function captureRouting(
	routing: ChannelRouting,
	nonInverted: boolean,
	ownerId: string,
): ChannelTemplate {
	const index = new RunIndex();
	const firsts = routing.wires.map(({ first }) => index.indexOf(first));
	const lasts = routing.wires.map(({ last }) => index.indexOf(last));
	const runFields: number[] = [];
	const nextOffsets = [0];
	const nextRuns: number[] = [];
	// The array iterator also visits runs appended while their predecessors' `next` is indexed.
	for (const run of index.runs) {
		runFields.push(run.key, run.rail, run.start, run.end, run.remaining, run.depth);
		for (const following of run.next) nextRuns.push(index.indexOf(following));
		nextOffsets.push(nextRuns.length);
	}
	const middleWires: number[] = [];
	const middles: number[] = [];
	for (const [position, { middle }] of routing.wires.entries()) {
		if (middle === undefined) continue;
		middleWires.push(position);
		middles.push(middle);
	}
	const { edge } = routing;
	return {
		nonInverted,
		ownerId,
		endpoints: endpointColumns(routing.wires),
		runFields,
		nextOffsets,
		nextRuns,
		firsts,
		lasts,
		middleWires,
		middles,
		tracks: [...routing.trackByRunKey].flat(),
		edge: { ownerId: edge.ownerId, capacity: edge.capacity, spacing: edge.spacing },
		railCount: routing.railCount,
	};
}

function replayRuns(template: ChannelTemplate): ChannelRun[] {
	const fields = template.runFields;
	const runs: ChannelRun[] = [];
	for (let offset = 0; offset < fields.length; offset += RUN_FIELDS) {
		runs.push({
			key: defined(fields[offset]),
			start: defined(fields[offset + 2]),
			end: defined(fields[offset + 3]),
			rail: defined(fields[offset + 1]),
			next: [],
			remaining: defined(fields[offset + 4]),
			depth: defined(fields[offset + 5]),
		});
	}
	for (const [position, run] of runs.entries()) {
		const end = defined(template.nextOffsets[position + 1]);
		for (let offset = defined(template.nextOffsets[position]); offset < end; offset += 1)
			run.next.push(defined(runs[defined(template.nextRuns[offset])]));
	}
	return runs;
}

/** Fresh runs, edge and track map with the remembered values and sharing, on the caller's wires. */
function replayRouting(template: ChannelTemplate, wires: ChannelWire[]): ChannelRouting {
	const runs = replayRuns(template);
	for (const [position, wire] of wires.entries()) {
		wire.first = runs[defined(template.firsts[position])];
		wire.last = runs[defined(template.lasts[position])];
	}
	for (const [offset, position] of template.middleWires.entries())
		defined(wires[position]).middle = template.middles[offset];
	const trackByRunKey = new Map<number, number>();
	for (let offset = 0; offset < template.tracks.length; offset += 2)
		trackByRunKey.set(defined(template.tracks[offset]), defined(template.tracks[offset + 1]));
	return { wires, edge: { ...template.edge }, trackByRunKey, railCount: template.railCount };
}

const HASH_SEED = 0x81_1c_9d_c5;
const HASH_PRIME = 0x01_00_01_93;

/**
 * Projection-owned: exact channel inputs replay the routing of the current or previous root
 * layout. `routeOwnedChannel` reads each wire's endpoint fields, their order, the corner-only
 * flag and the owner, and nothing else: no option, module state or randomness.
 */
export class ChannelRoutingCache {
	#current = new Map<string, ChannelTemplate>();
	#previous = new Map<string, ChannelTemplate>();
	#currentWires = 0;
	#previousWires = 0;
	#hits = 0;
	#misses = 0;
	readonly #bits = new Float64Array(1);
	readonly #words = new Uint32Array(this.#bits.buffer);

	get stats(): ChannelRoutingCacheStats {
		return {
			entries: this.#current.size + this.#previous.size,
			wires: this.#currentWires + this.#previousWires,
			hits: this.#hits,
			misses: this.#misses,
		};
	}

	/** Keep only what the last root layout routed; called once at every root layout entry. */
	beginLayout(): void {
		this.#previous = this.#current;
		this.#previousWires = this.#currentWires;
		this.#current = new Map();
		this.#currentWires = 0;
	}

	/** Same contract as `routeOwnedChannel`: fresh wires, run references filled in place. */
	route(wires: ChannelWire[], nonInverted: boolean, ownerId: string): ChannelRouting {
		const key = this.#key(wires, nonInverted, ownerId);
		const current = this.#current.get(key);
		if (current !== undefined && sameInputs(current, wires, nonInverted, ownerId)) {
			this.#hits += 1;
			return replayRouting(current, wires);
		}
		const previous = this.#previous.get(key);
		if (previous !== undefined && sameInputs(previous, wires, nonInverted, ownerId)) {
			this.#hits += 1;
			this.#previous.delete(key);
			this.#previousWires -= wires.length;
			this.#remember(key, previous);
			return replayRouting(previous, wires);
		}
		this.#misses += 1;
		const routing = routeOwnedChannel(wires, nonInverted, ownerId);
		if (this.#currentWires + wires.length <= MAX_CHANNEL_ROUTING_GENERATION_WIRES)
			this.#remember(key, captureRouting(routing, nonInverted, ownerId));
		return routing;
	}

	#remember(key: string, template: ChannelTemplate): void {
		const replaced = this.#current.get(key);
		if (replaced !== undefined) this.#currentWires -= replaced.endpoints.id.length;
		this.#current.set(key, template);
		this.#currentWires += template.endpoints.id.length;
	}

	/** Owner, flag, length, first and last id and a fold of the coordinate bits; verified exactly. */
	#key(wires: readonly ChannelWire[], nonInverted: boolean, ownerId: string): string {
		let hash = HASH_SEED;
		for (const { source, target } of wires) {
			hash = this.#fold(hash, source);
			hash = this.#fold(hash, target);
		}
		const first = wires[0]?.id ?? '';
		const last = wires.at(-1)?.id ?? '';
		return `${ownerId}\u0000${String(nonInverted)}\u0000${wires.length}\u0000${first}\u0000${last}\u0000${hash}`;
	}

	#fold(hash: number, value: number): number {
		this.#bits[0] = value;
		const low = Math.imul(hash ^ defined(this.#words[0]), HASH_PRIME);
		return Math.imul(low ^ defined(this.#words[1]), HASH_PRIME);
	}
}
