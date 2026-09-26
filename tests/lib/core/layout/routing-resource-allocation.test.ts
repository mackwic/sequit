import { describe, expect, it } from 'vitest';

import {
	allocateCenteredTrack,
	allocateNestedTracks,
	centeredTrackOffset,
	edgeExtent,
	type RoutingEdge,
	type RoutingTrackDemand,
	trackOffset,
} from '../../../../src/lib/core/layout/resources/routing-resource-allocation';

const processBus: RoutingEdge = { ownerId: 'sales-process', capacity: 4, spacing: 24 };

describe('routing resource allocation examples', () => {
	it('puts nested route windows on inner-to-outer tracks within the reserved bus extent', () => {
		const allocation = allocateNestedTracks(processBus, [
			{ relationId: 'outer-request', start: 0, end: 120 },
			{ relationId: 'middle-reply', start: 18, end: 96 },
			{ relationId: 'inner-approval', start: 72, end: 30 },
		]);

		expect(allocation.trackByRelationId).toEqual(
			new Map([
				['outer-request', 2],
				['middle-reply', 1],
				['inner-approval', 0],
			]),
		);
		expect(edgeExtent(processBus)).toBe(96);
		for (const track of allocation.trackByRelationId.values())
			expect(trackOffset(processBus, track)).toBeLessThanOrEqual(edgeExtent(processBus));
	});

	it('uses strict interval containment before declared precedence, then canonical identifiers', () => {
		const boundaryEdge: RoutingEdge = { ownerId: 'approval-rail', capacity: 4, spacing: 16 };
		const boundaryAllocation = allocateNestedTracks(boundaryEdge, [
			{ relationId: 'z-outer', start: 10, end: 80 },
			{ relationId: 'a-shared-start', start: 10, end: 50 },
			{ relationId: 'b-shared-end', start: 30, end: 80 },
			{ relationId: 'c-strictly-inside', start: 70, end: 20 },
		]);

		expect(boundaryAllocation.trackByRelationId).toEqual(
			new Map([
				['z-outer', 3],
				['a-shared-start', 0],
				['b-shared-end', 1],
				['c-strictly-inside', 2],
			]),
		);

		const precedenceEdge: RoutingEdge = { ownerId: 'lane-gutter', capacity: 5, spacing: 20 };
		const demands: readonly RoutingTrackDemand[] = [
			{ relationId: 'unranked', start: -40, end: 40 },
			{ relationId: 'z-second', start: 0, end: 100, order: 3 },
			{ relationId: 'd-first', start: 0, end: 100, order: 1 },
			{ relationId: 'a-first', start: 100, end: 0, order: 1 },
			{ relationId: 'b-second', start: 0, end: 100, order: 2 },
		];
		const ordered = allocateNestedTracks(precedenceEdge, demands);
		const permuted = allocateNestedTracks(precedenceEdge, [...demands].reverse());
		expect(ordered.trackByRelationId).toEqual(
			new Map([
				['unranked', 4],
				['z-second', 3],
				['d-first', 1],
				['a-first', 0],
				['b-second', 2],
			]),
		);
		expect(permuted.trackByRelationId).toEqual(ordered.trackByRelationId);
	});

	it('accepts an exactly full edge, keeps an empty edge empty, and rejects the next demand', () => {
		const edge: RoutingEdge = { ownerId: 'cell-column-2', capacity: 2, spacing: 18 };
		const demands = [
			{ relationId: 'northbound', start: 20, end: 80 },
			{ relationId: 'southbound', start: 100, end: 160 },
		] as const;

		expect(allocateNestedTracks(edge, demands).trackByRelationId).toEqual(
			new Map([['northbound', 0], ['southbound', 1]]),
		);
		expect(allocateNestedTracks({ ...edge, capacity: 0 }, []).trackByRelationId).toEqual(
			new Map(),
		);
		expect(() =>
			allocateNestedTracks(edge, [...demands, { relationId: 'extra-crossing', start: 0, end: 1 }]),
		).toThrow(/cell-column-2/);
	});

	it('centres a free-interval passage without treating it as a spacing-grid track', () => {
		const edge: RoutingEdge = { ownerId: 'empty-rank-passage', capacity: 1, spacing: 20 };
		const allocation = allocateCenteredTrack(edge, {
			relationId: 'between-ranks',
			start: 8,
			end: 52,
		});

		expect(allocation.track).toBe(0);
		expect(edgeExtent(edge)).toBe(20);
		expect(centeredTrackOffset(allocation)).toBe(30);
		expect(
			centeredTrackOffset(
				allocateCenteredTrack(edge, { relationId: 'reverse', start: 52, end: 8 }),
			),
		).toBe(30);
	});
});
