import { compareCanonicalStrings } from '../../../../lib/core/canonical-string';
import type {
	RenderedLayout,
	ReportedBox,
	ReportedLayout,
	ReportedMeasurements,
} from '../../../../lib/infrastructure/layout-report/layout-report';
import type { Bounds, LayoutMeasurements } from '../../projection/layout-graph';
import type { CanvasModel } from '../canvas/canvas-model';

export type Rename = (id: string) => string;

/**
 * Known identifiers take their anonymous token. Anything else, which the document did not
 * define, takes `x0`, `x1`… in order of first appearance, so that nothing original leaves.
 */
export function createRename(known: ReadonlyMap<string, string>): Rename {
	const others = new Map<string, string>();
	return (id) => {
		const token = known.get(id) ?? others.get(id);
		if (token !== undefined) return token;
		const next = `x${others.size}`;
		others.set(id, next);
		return next;
	};
}

function byId<T>(items: ReadonlyMap<string, T>, rename: Rename): readonly (readonly [string, T])[] {
	const renamed = [...items].map(([id, value]) => [rename(id), value] as const);
	return renamed.sort(([left], [right]) => compareCanonicalStrings(left, right));
}

export function reportedMeasurements(
	measurements: LayoutMeasurements,
	rename: Rename,
): ReportedMeasurements {
	return {
		nodes: byId(measurements.nodes, rename),
		junctions: byId(measurements.junctions, rename),
		groups: byId(measurements.groups, rename),
	};
}

function boxes(
	items: readonly { readonly id: string; readonly bounds: Bounds }[],
	rename: Rename,
): readonly ReportedBox[] {
	return items.map(({ id, bounds }) => ({ id: rename(id), bounds }));
}

/** The geometry of a canvas, without its texts, under anonymous identifiers. */
export function reportedLayout(canvas: CanvasModel, rename: Rename): ReportedLayout {
	return {
		width: canvas.width,
		height: canvas.height,
		nodes: boxes(canvas.nodes, rename),
		groups: boxes(canvas.groups, rename),
		junctions: boxes(canvas.junctions, rename),
		relations: canvas.relations.map(({ id, from, to, points }) => ({
			id: rename(id),
			from: rename(from),
			to: rename(to),
			points,
		})),
		lanes: (canvas.lanes ?? []).map(({ id, bounds, regionId }) => {
			const lane = { id: rename(id), bounds };
			if (regionId === undefined) return lane;
			return { ...lane, regionId: rename(regionId) };
		}),
		regions: boxes(canvas.regions ?? [], rename),
	};
}

interface StageFrame {
	readonly left: number;
	readonly top: number;
	readonly zoom: number;
}

function renderedBoxes(
	stage: HTMLElement,
	attribute: string,
	frame: StageFrame,
	rename: Rename,
): readonly ReportedBox[] {
	return [...stage.querySelectorAll(`[${attribute}]`)].flatMap((element) => {
		const id = element.getAttribute(attribute);
		if (id === null || id === '') return [];
		const rect = element.getBoundingClientRect();
		const bounds = {
			x: (rect.left - frame.left) / frame.zoom,
			y: (rect.top - frame.top) / frame.zoom,
			width: rect.width / frame.zoom,
			height: rect.height / frame.zoom,
		};
		return [{ id: rename(id), bounds }];
	});
}

/**
 * Reads back what the page drew: entity boxes from their elements and routes from their SVG
 * paths, brought to canvas coordinates. `undefined` while no canvas is drawn.
 */
export function readRenderedLayout(
	viewport: HTMLElement,
	rename: Rename,
): RenderedLayout | undefined {
	const stage = viewport.querySelector<HTMLElement>('[data-graph-stage]');
	if (stage === null) return undefined;
	const width = Number(stage.dataset['stageWidth']);
	const height = Number(stage.dataset['stageHeight']);
	const rect = stage.getBoundingClientRect();
	if (!(width > 0)) return undefined;
	if (!(rect.width > 0)) return undefined;
	const frame = { left: rect.left, top: rect.top, zoom: rect.width / width };
	return {
		width,
		height,
		zoom: frame.zoom,
		nodes: renderedBoxes(stage, 'data-node-id', frame, rename),
		groups: renderedBoxes(stage, 'data-group-id', frame, rename),
		junctions: renderedBoxes(stage, 'data-junction-id', frame, rename),
		relations: [...stage.querySelectorAll('path[data-rendered-relation-id]')].map((path) => ({
			id: rename(path.getAttribute('data-rendered-relation-id') ?? ''),
			path: path.getAttribute('d') ?? '',
		})),
	};
}
