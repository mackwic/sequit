import { compareCanonicalStrings } from '../canonical-string';
import {
	defined,
	type GridLayoutPresentation,
	type LayoutLane,
	type LayoutRegionDefinition,
	type LogicDocument,
	type RegionLanePresentation,
	type RegionLayoutPresentation,
	type RootLayoutPresentation,
} from './logic-document';

/** Every text a document holds becomes this, whatever it said. */
export const ANONYMOUS_TEXT = 'xxx';
const ANONYMOUS_IDENTIFIER = /^e\d+$/;

export interface AnonymizedDocument {
	readonly document: LogicDocument;
	/** Original identifier → anonymous one; both sides sort in the same canonical order. */
	readonly identifiers: ReadonlyMap<string, string>;
}

type Rename = (id: string) => string;

function laneIds(lanes: readonly LayoutLane[] | undefined): readonly string[] {
	return lanes?.map(({ id }) => id) ?? [];
}

/** Defined identifiers; a lane id scoped to its leaf may repeat and is still one string. */
function definedIdentifiers(document: LogicDocument): readonly string[] {
	const regions = document.regionPresentation?.regions ?? [];
	return [
		document.id,
		...[document.natures, document.groups, document.nodes, document.junctions, document.relations]
			.flat()
			.map(({ id }) => id),
		...laneIds(document.presentation?.lanes),
		...regions.flatMap((region) => [region.id, ...laneIds(region.lanePresentation?.lanes)]),
	];
}

/**
 * Same-width tokens compare like their indices, so a token sorts exactly where its original
 * did: a layout that orders or breaks ties by identifier still decides the same way.
 */
function anonymousIdentifiers(document: LogicDocument): ReadonlyMap<string, string> {
	const ids = [...new Set(definedIdentifiers(document))].sort(compareCanonicalStrings);
	const width = String(Math.max(ids.length - 1, 0)).length;
	return new Map(ids.map((id, index) => [id, `e${String(index).padStart(width, '0')}`]));
}

interface Placement {
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

function placement(item: Placement, rename: Rename): Placement {
	const fields: { groupId?: string; laneId?: string; regionId?: string } = {};
	if (item.groupId !== undefined) fields.groupId = rename(item.groupId);
	if (item.laneId !== undefined) fields.laneId = rename(item.laneId);
	if (item.regionId !== undefined) fields.regionId = rename(item.regionId);
	return fields;
}

function lanes(items: readonly LayoutLane[], rename: Rename): readonly LayoutLane[] {
	return items.map((lane) => ({ ...lane, id: rename(lane.id), label: ANONYMOUS_TEXT }));
}

function grid(value: GridLayoutPresentation, rename: Rename): GridLayoutPresentation {
	return {
		...value,
		cells: value.cells.map((cell) => ({ ...cell, regionId: rename(cell.regionId) })),
	};
}

function region(definition: LayoutRegionDefinition, rename: Rename): LayoutRegionDefinition {
	const fields: {
		id: string;
		parentId?: string;
		lanePresentation?: RegionLanePresentation;
		grid?: GridLayoutPresentation;
	} = { id: rename(definition.id) };
	if (definition.parentId !== undefined) fields.parentId = rename(definition.parentId);
	if (definition.lanePresentation !== undefined)
		fields.lanePresentation = {
			...definition.lanePresentation,
			lanes: lanes(definition.lanePresentation.lanes, rename),
		};
	if (definition.grid !== undefined) fields.grid = grid(definition.grid, rename);
	return { ...definition, ...fields };
}

function regionPresentation(
	value: RegionLayoutPresentation,
	rename: Rename,
): RegionLayoutPresentation {
	const regions = value.regions.map((definition) => region(definition, rename));
	if (value.grid === undefined) return { ...value, regions };
	return { ...value, regions, grid: grid(value.grid, rename) };
}

function presentation(value: RootLayoutPresentation, rename: Rename): RootLayoutPresentation {
	return { ...value, lanes: lanes(value.lanes, rename) };
}

function content(document: LogicDocument, rename: Rename): LogicDocument {
	return {
		...document,
		id: rename(document.id),
		title: ANONYMOUS_TEXT,
		natures: document.natures.map((nature) => ({
			...nature,
			id: rename(nature.id),
			label: ANONYMOUS_TEXT,
		})),
		groups: document.groups.map((group) => ({
			...group,
			...placement(group, rename),
			id: rename(group.id),
			label: ANONYMOUS_TEXT,
		})),
		nodes: document.nodes.map((node) => {
			const renamed = {
				...node,
				...placement(node, rename),
				id: rename(node.id),
				natureId: rename(node.natureId),
				markdown: ANONYMOUS_TEXT,
			};
			if (node.description === undefined) return renamed;
			return { ...renamed, description: ANONYMOUS_TEXT };
		}),
		junctions: document.junctions.map((junction) => ({
			...junction,
			...placement(junction, rename),
			id: rename(junction.id),
		})),
		relations: document.relations.map((relation) => ({
			id: rename(relation.id),
			from: rename(relation.from),
			to: rename(relation.to),
		})),
	};
}

/**
 * Replaces every text with `xxx` and every identifier with an order-preserving token. Layout reads
 * measured sizes, not texts, so the same measurements lay the result out like the original.
 */
export function anonymizeDocument(document: LogicDocument): AnonymizedDocument {
	const identifiers = anonymousIdentifiers(document);
	const rename: Rename = (id) => defined(identifiers.get(id), `Unknown identifier: ${id}`);
	let anonymized = content(document, rename);
	if (document.presentation !== undefined)
		anonymized = { ...anonymized, presentation: presentation(document.presentation, rename) };
	if (document.regionPresentation !== undefined)
		anonymized = {
			...anonymized,
			regionPresentation: regionPresentation(document.regionPresentation, rename),
		};
	return { document: anonymized, identifiers };
}

function documentTexts(document: LogicDocument): readonly string[] {
	const regions = document.regionPresentation?.regions ?? [];
	return [
		document.title,
		...document.natures.map(({ label }) => label),
		...document.groups.map(({ label }) => label),
		...document.nodes.flatMap(({ markdown, description }) => [markdown, description ?? '']),
		...(document.presentation?.lanes ?? []).map(({ label }) => label),
		...regions.flatMap(({ lanePresentation }) =>
			(lanePresentation?.lanes ?? []).map(({ label }) => label),
		),
	];
}

/** Whether a document carries nothing but `xxx` texts and anonymous identifiers. */
export function isAnonymizedDocument(document: LogicDocument): boolean {
	const texts = documentTexts(document).filter((text) => text !== '');
	if (texts.some((text) => text !== ANONYMOUS_TEXT)) return false;
	return definedIdentifiers(document).every((id) => ANONYMOUS_IDENTIFIER.test(id));
}
