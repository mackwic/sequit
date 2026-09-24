import { performance } from 'node:perf_hooks';

import { expect, it } from 'vitest';

import { DocumentProjection } from '../../../../../src/app/web/projection/document-projection';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../../../src/app/workshop/fixtures/layout-performance/scenarios';
import type { LogicDocument } from '../../../../../src/lib/core/document/logic-document';
import { layoutMeasurementsForCanvas } from '../../../../support/builders/layout-measurements';
import { median, percentile } from '../../../../support/performance/performance-statistics';

const NODE_COUNT = 300;
const WARMUP_EDITS = 8;
const SAMPLED_EDITS = 48;

interface StringifySamples {
	readonly durations: number[];
	readonly lengths: number[];
}

function editFirstNode(document: LogicDocument, edit: number): LogicDocument {
	return {
		...document,
		nodes: document.nodes.map((node, index) => {
			if (index !== 0) return node;
			return { ...node, markdown: `Edit ${edit.toString().padStart(4, '0')}` };
		}),
	};
}

async function heapAfterGc(): Promise<number | undefined> {
	if (typeof globalThis.gc !== 'function') return undefined;
	await new Promise<void>((resolve) => setImmediate(resolve));
	globalThis.gc();
	globalThis.gc();
	return process.memoryUsage().heapUsed;
}

function sampleSummary(name: string, samples: StringifySamples): string {
	return `${name} p50=${median(samples.durations).toFixed(3)}ms p95=${percentile(samples.durations, 95).toFixed(3)}ms chars=${median(samples.lengths).toFixed(0)}`;
}

function formatHeap(
	before: number | undefined,
	middle: number | undefined,
	after: number | undefined,
) {
	if (before === undefined || middle === undefined || after === undefined)
		return 'heapAfterGC=unavailable';
	const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
	return `heapAfterGC=${mib(before)}→${mib(middle)}→${mib(after)}MiB delta=${mib(after - before)}MiB`;
}

it('profiles projection update fingerprints and settled heap without a performance threshold', async () => {
	const scenario = LAYOUT_PERFORMANCE_SCENARIOS.find(({ name }) => name === 'long-queue');
	if (scenario === undefined) throw new Error('Missing long-queue performance scenario');
	let document = scenario.createBuilder().buildSnapshot(NODE_COUNT).document;
	const projection = new DocumentProjection(document);
	const measurements = layoutMeasurementsForCanvas(projection.measurementModel);
	let canvas = await projection.createCanvasModel(measurements);
	const originalRelations = canvas.relations;

	const topology: StringifySamples = { durations: [], lengths: [] };
	const measurement: StringifySamples = { durations: [], lengths: [] };
	const updateDurations: number[] = [];
	const stringify = JSON.stringify;
	let recording = false;
	const wrapper: typeof JSON.stringify = (...args) => {
		const start = performance.now();
		const replacer = args[1];
		let result: string;
		if (typeof replacer === 'function' || replacer === undefined)
			result = stringify(args[0], replacer, args[2]);
		else result = stringify(args[0], replacer, args[2]);
		if (recording) {
			let sample = measurement;
			if (Array.isArray(args[0])) sample = topology;
			sample.durations.push(performance.now() - start);
			sample.lengths.push(result.length);
		}
		return result;
	};
	JSON.stringify = wrapper;

	let before: number | undefined;
	let middle: number | undefined;
	let after: number | undefined;
	try {
		for (let index = 0; index < WARMUP_EDITS + SAMPLED_EDITS; index += 1) {
			document = editFirstNode(document, index);
			recording = index >= WARMUP_EDITS;
			const start = performance.now();
			const changed = projection.update(document);
			if (recording) updateDurations.push(performance.now() - start);
			recording = false;
			expect(changed).toBe(true);
			canvas = await projection.createCanvasModel(measurements);
			expect(canvas.nodes[0]?.markdown).toBe(`Edit ${index.toString().padStart(4, '0')}`);
			expect(canvas.relations).toBe(originalRelations);
			if (index === WARMUP_EDITS - 1) before = await heapAfterGc();
			if (index === WARMUP_EDITS + SAMPLED_EDITS / 2 - 1) middle = await heapAfterGc();
		}
		after = await heapAfterGc();
	} finally {
		JSON.stringify = stringify;
	}

	expect(topology.durations).toHaveLength(SAMPLED_EDITS);
	expect(measurement.durations).toHaveLength(SAMPLED_EDITS);
	process.stdout.write(
		`\nProjection cache profile: long-queue nodes=${NODE_COUNT} equal-size text edits=${SAMPLED_EDITS} warmup=${WARMUP_EDITS}; ${sampleSummary('topology stringify', topology)}; ${sampleSummary('measurement stringify', measurement)}; update p50=${median(updateDurations).toFixed(3)}ms p95=${percentile(updateDurations, 95).toFixed(3)}ms; ${formatHeap(before, middle, after)}\n`,
	);
}, 120_000);

it('compares a cached text edit with a cold projection on a medium document', async () => {
	const scenario = LAYOUT_PERFORMANCE_SCENARIOS.find(({ name }) => name === 'long-queue');
	if (scenario === undefined) throw new Error('Missing long-queue performance scenario');
	let document = scenario.createBuilder().buildSnapshot(80).document;
	const projection = new DocumentProjection(document);
	const measurements = layoutMeasurementsForCanvas(projection.measurementModel);
	await projection.createCanvasModel(measurements);

	const cached: number[] = [];
	const cold: number[] = [];
	for (let index = 0; index < 32; index += 1) {
		document = editFirstNode(document, index);
		const cachedStart = performance.now();
		projection.update(document);
		await projection.createCanvasModel(measurements);
		if (index >= 8) cached.push(performance.now() - cachedStart);

		const coldStart = performance.now();
		const fresh = new DocumentProjection(document);
		await fresh.createCanvasModel(measurements);
		if (index >= 8) cold.push(performance.now() - coldStart);
	}
	process.stdout.write(
		`\nProjection cache comparison: long-queue nodes=80 text edits=24 warmup=8; cached update+canvas p50=${median(cached).toFixed(3)}ms p95=${percentile(cached, 95).toFixed(3)}ms; cold construct+canvas p50=${median(cold).toFixed(3)}ms p95=${percentile(cold, 95).toFixed(3)}ms\n`,
	);
}, 120_000);
