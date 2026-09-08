import type { Component } from 'svelte';

import type { EntityRef } from '$lib/canvas/canvas-entity';
import type { CanvasModel } from '$lib/canvas/canvas-model';
import type { LogicDocument } from '$lib/document/logic-document';
import type { CanvasSession } from '$lib/session/canvas-session.svelte';

import type { WorkshopDocument } from './runtime/workshop-document';

export interface WorkshopViewSettings {
	collapsed: string[];
	spacing: number;
}
export type EditorPlacement = 'overlay' | 'panel';
export interface WorkshopInitialState {
	readonly zoom: number;
	readonly selection: readonly EntityRef[];
}
export interface WorkshopFrame {
	readonly panel?: 'left' | 'right' | 'split' | 'overlay';
	readonly contextualActions?: 'default' | 'custom';
}
export interface WorkshopSceneProps {
	readonly frame?: WorkshopFrame | undefined;
	readonly tools?: Component<WorkbenchToolProps> | undefined;
	readonly presentation?: string | undefined;
	readonly source: string;
	readonly initialState: WorkshopInitialState;
}
export interface WorkshopVariant {
	readonly frame?: WorkshopFrame;
	readonly tools?: Component<WorkbenchToolProps>;
	readonly presentation?: string;
	readonly id: string;
	readonly label: string;
	readonly tag: string;
	readonly description: string;
	readonly question: string;
	readonly scene: Component<WorkshopSceneProps>;
}
export interface WorkshopScenario {
	readonly id: string;
	readonly label: string;
	readonly journey: string;
	readonly title: string;
	readonly subtitle: string;
	readonly instruction: string;
	readonly fixtureInstruction?: (nodeCount: number) => string;
	readonly source: string;
	readonly initialState: WorkshopInitialState;
	readonly variants: readonly [WorkshopVariant, ...WorkshopVariant[]];
}
export interface WorkshopGroup {
	readonly id: string;
	readonly label: string;
	readonly scenarios: readonly [WorkshopScenario, ...WorkshopScenario[]];
}

export interface WorkbenchToolProps {
	readonly workbench: Pick<WorkshopDocument, 'commands' | 'read' | 'text' | 'import'>;
	readonly view: WorkshopViewSettings;
	readonly setView: (changes: Partial<WorkshopViewSettings>) => void;
	readonly session: CanvasSession;
	readonly model: LogicDocument;
	readonly presentation: string;
	readonly viewport: HTMLDivElement | undefined;
	readonly canvas: CanvasModel | undefined;
	readonly report: (message: string, error?: boolean) => void;
}
