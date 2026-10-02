import { defined } from '../../document/logic-document';
import type { ChannelWire } from './channel-types';

interface ChannelTraverse {
	readonly start: number;
	readonly end: number;
	readonly rail: number;
}

/** Price each owner's actual span, not the union reserved by a shared run. */
function channelTraverses(wires: readonly ChannelWire[]): ChannelTraverse[] {
	const traverses: ChannelTraverse[] = [];
	for (const wire of wires) {
		if (wire.first === undefined) continue;
		const middle = wire.middle ?? wire.target;
		if (wire.first.rail === defined(wire.last).rail) {
			const start = Math.min(wire.source, middle, wire.target);
			const end = Math.max(wire.source, middle, wire.target);
			if (start !== end) traverses.push({ start, end, rail: wire.first.rail });
			continue;
		}
		if (wire.source !== middle)
			traverses.push({
				start: Math.min(wire.source, middle),
				end: Math.max(wire.source, middle),
				rail: wire.first.rail,
			});
		if (middle !== wire.target)
			traverses.push({
				start: Math.min(middle, wire.target),
				end: Math.max(middle, wire.target),
				rail: defined(wire.last).rail,
			});
	}
	return traverses;
}

/** Three column streams share one sweep and a Fenwick tree of active traverses by rail. */
class ChannelCrossingSweep {
	readonly #starts: readonly ChannelTraverse[];
	readonly #ends: readonly ChannelTraverse[];
	readonly #tree: Int32Array;
	readonly #sources: readonly ChannelWire[];
	readonly #targets: readonly ChannelWire[];
	readonly #middles: readonly ChannelWire[];
	readonly #railCount: number;
	#start = 0;
	#end = 0;
	#source = 0;
	#target = 0;
	#middle = 0;

	constructor(wires: readonly ChannelWire[], railCount: number) {
		const traverses = channelTraverses(wires);
		this.#ends = [...traverses].sort((a, b) => a.end - b.end);
		this.#starts = traverses.sort((a, b) => a.start - b.start);
		this.#tree = new Int32Array(railCount + 1);
		this.#railCount = railCount;
		this.#sources = [...wires].sort((a, b) => a.source - b.source);
		this.#targets = [...wires].sort((a, b) => a.target - b.target);
		this.#middles = wires
			.filter((wire) => wire.middle !== undefined)
			.sort((a, b) => defined(a.middle) - defined(b.middle));
	}

	count(): number {
		let count = 0;
		while (this.#hasRisers()) {
			const column = this.#nextColumn();
			this.#advance(column);
			count += this.#crossingsAt(column);
		}
		return count;
	}

	#hasRisers(): boolean {
		const sources = this.#source < this.#sources.length;
		const targets = this.#target < this.#targets.length;
		const middles = this.#middle < this.#middles.length;
		return sources || targets || middles;
	}

	#nextColumn(): number {
		const source = this.#sources[this.#source]?.source ?? Infinity;
		const target = this.#targets[this.#target]?.target ?? Infinity;
		const middle = this.#middles[this.#middle]?.middle ?? Infinity;
		return Math.min(source, target, middle);
	}

	#addRail(rail: number, weight: number): void {
		for (let index = rail + 1; index < this.#tree.length; index += index & -index)
			this.#tree[index] = defined(this.#tree[index]) + weight;
	}

	/** Active traverses strictly before this rail, with one occurrence per owning relation. */
	#prefixCount(rail: number): number {
		let count = 0;
		for (let index = rail; index > 0; index -= index & -index) count += defined(this.#tree[index]);
		return count;
	}

	#advance(column: number): void {
		while (this.#start < this.#starts.length) {
			const run = defined(this.#starts[this.#start]);
			if (run.start >= column) break;
			this.#addRail(run.rail, 1);
			this.#start += 1;
		}
		while (this.#end < this.#ends.length) {
			const run = defined(this.#ends[this.#end]);
			if (run.end > column) break;
			this.#addRail(run.rail, -1);
			this.#end += 1;
		}
	}

	#crossingsAt(column: number): number {
		let count = 0;
		while (this.#sources[this.#source]?.source === column) {
			const wire = defined(this.#sources[this.#source++]);
			count += this.#prefixCount(wire.first?.rail ?? this.#railCount);
		}
		while (this.#targets[this.#target]?.target === column) {
			const wire = defined(this.#targets[this.#target++]);
			if (wire.last !== undefined)
				count += this.#prefixCount(this.#railCount) - this.#prefixCount(wire.last.rail + 1);
		}
		while (this.#middles[this.#middle]?.middle === column) {
			const wire = defined(this.#middles[this.#middle++]);
			const first = defined(wire.first).rail;
			const last = defined(wire.last).rail;
			if (first === last) continue;
			count +=
				this.#prefixCount(Math.max(first, last)) - this.#prefixCount(Math.min(first, last) + 1);
		}
		return count;
	}
}

/** Count all strict channel crossings, including shared traverses, straight wires and split risers. */
export function countChannelCrossings(wires: readonly ChannelWire[], railCount: number): number {
	return new ChannelCrossingSweep(wires, railCount).count();
}
