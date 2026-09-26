import type { EndpointKind } from '../document/logic-document';

export interface Size {
	readonly width: number;
	readonly height: number;
}

export interface GroupMeasurement {
	readonly minimumWidth: number;
	readonly minimumHeight: number;
	readonly headerHeight: number;
	readonly padding: number;
}

export interface LayoutMeasurements {
	readonly nodes: ReadonlyMap<string, Size>;
	readonly junctions: ReadonlyMap<string, Size>;
	readonly groups: ReadonlyMap<string, GroupMeasurement>;
}

export interface Bounds extends Size {
	readonly x: number;
	readonly y: number;
}

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface LayoutElement {
	readonly id: string;
	readonly kind: EndpointKind;
	readonly bounds: Bounds;
}

export interface LayoutRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly points: readonly Point[];
}

export interface LayoutResult {
	readonly routingInspection?: RoutingInspection | undefined;
	readonly lanes?: readonly {
		readonly id: string;
		readonly bounds: Bounds;
		readonly regionId?: string;
		readonly label?: string;
	}[];
	readonly regions?: readonly { readonly id: string; readonly bounds: Bounds }[];
	readonly width: number;
	readonly height: number;
	readonly elements: readonly LayoutElement[];
	readonly relations: readonly LayoutRelation[];
}

export interface LayoutOptions {
	readonly inspectRouting?: boolean;
}

/** A deferred diagnostic permits rank search to discard candidates without materializing inspection. */
export interface DedicatedLayoutEvaluation {
	readonly result: LayoutResult;
	complete(): LayoutResult;
}

/** Flow role of a derived routing port; its geometric side comes from the layout direction. */
export enum RoutingPortRole {
	Incoming = 'incoming',
	Outgoing = 'outgoing',
}

export interface InspectedPort {
	readonly role: RoutingPortRole;
	readonly point: Point;
	readonly relations: string[];
}
export interface InspectedNode {
	readonly id: string;
	readonly content: Bounds;
	readonly incomingMinimum: number;
	readonly outgoingMinimum: number;
	readonly ports: readonly InspectedPort[];
}
export interface InspectedRail {
	readonly coordinate: number;
	readonly relations: string[];
	readonly junctions?: readonly string[];
}
export interface InspectedCorridor {
	/** Zero-based target rank, as in the graph. */
	readonly rank: number;
	readonly bounds: Bounds;
	readonly requiredGap: number;
	readonly allocated: boolean;
	readonly rails: readonly InspectedRail[];
}
export interface RoutingInspection {
	readonly vertical: boolean;
	readonly nodes: readonly InspectedNode[];
	readonly corridors: readonly InspectedCorridor[];
}

export interface RoutingLayers {
	readonly rows: readonly (readonly string[])[];
	readonly byId: ReadonlyMap<string, number>;
	readonly intervals: readonly number[];
}
