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
	readonly kind: 'node' | 'junction' | 'group';
	readonly bounds: Bounds;
}

export interface LayoutRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly points: readonly Point[];
}

export interface LayoutResult {
	readonly width: number;
	readonly height: number;
	readonly elements: readonly LayoutElement[];
	readonly relations: readonly LayoutRelation[];
}
