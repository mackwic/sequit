import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { PORT_INSET, PORT_SPACING } from './layout-settings';
import type { SharedLaneOutgoingIncident } from './shared-lane-incident-contract';
import type {
	LaneSide,
	SharedLaneEndpoint,
	SharedLaneInput,
	SharedLanePlan,
} from './shared-lane-model';

export enum PortRole {
	Source = 'source',
	Target = 'target',
}

interface PortIncidence {
	readonly relationId: string;
	readonly role: PortRole;
	readonly oppositeRow: number;
	readonly oppositeId: string;
}

interface PortGroup {
	readonly endpointId: string;
	readonly side: LaneSide;
	readonly incidences: PortIncidence[];
}

export interface SharedLanePorts {
	readonly offsetByIncidence: ReadonlyMap<string, number>;
	readonly demandByEndpoint: ReadonlyMap<string, number>;
}

export function incidenceKey(relationId: string, role: PortRole): string {
	return JSON.stringify([relationId, role]);
}

interface IncidenceInput {
	readonly plan: SharedLanePlan;
	readonly endpoint: SharedLaneEndpoint;
	readonly other: SharedLaneEndpoint;
	readonly side: LaneSide;
	readonly role: PortRole;
}

function addIncidence(groups: Map<string, PortGroup>, input: IncidenceInput): void {
	const { plan, endpoint, other, side, role } = input;
	const key = JSON.stringify([endpoint.id, side]);
	let group = groups.get(key);
	if (group === undefined) {
		group = { endpointId: endpoint.id, side, incidences: [] };
		groups.set(key, group);
	}
	group.incidences.push({
		relationId: plan.id,
		role,
		oppositeRow: other.row,
		oppositeId: other.id,
	});
}

function compareIncidences(a: PortIncidence, b: PortIncidence): number {
	const row = a.oppositeRow - b.oppositeRow;
	if (row !== 0) return row;
	const other = compareCanonicalStrings(a.oppositeId, b.oppositeId);
	if (other !== 0) return other;
	return compareCanonicalStrings(a.relationId, b.relationId);
}

export function planSharedLanePorts(
	input: SharedLaneInput,
	incident?: SharedLaneOutgoingIncident,
): SharedLanePorts {
	const groups = new Map<string, PortGroup>();
	for (const plan of input.plans) {
		const source = defined(input.endpoints.get(plan.from));
		const target = defined(input.endpoints.get(plan.to));
		addIncidence(groups, {
			plan,
			endpoint: source,
			other: target,
			side: plan.sourceSide,
			role: PortRole.Source,
		});
		addIncidence(groups, {
			plan,
			endpoint: target,
			other: source,
			side: plan.targetSide,
			role: PortRole.Target,
		});
	}
	const offsetByIncidence = new Map<string, number>();
	const demandByEndpoint = new Map<string, number>();
	for (const group of groups.values()) {
		group.incidences.sort(compareIncidences);
		const count = group.incidences.length;
		let reserved = false;
		if (incident !== undefined) {
			const matchingEndpoint = group.endpointId === incident.endpointId;
			reserved = matchingEndpoint && group.side === incident.side;
		}
		const spread = (count - 1) * PORT_SPACING;
		let required = 2 * PORT_INSET + spread;
		if (reserved) {
			const furthestPort = count * PORT_SPACING;
			required = 2 * (PORT_INSET + furthestPort);
		}
		demandByEndpoint.set(
			group.endpointId,
			Math.max(demandByEndpoint.get(group.endpointId) ?? 0, required),
		);
		for (const [index, incidence] of group.incidences.entries()) {
			const center = (count - 1) / 2;
			let offset = (index - center) * PORT_SPACING;
			if (reserved) {
				const portIndex = index + 1;
				offset = -portIndex * PORT_SPACING;
			}
			offsetByIncidence.set(incidenceKey(incidence.relationId, incidence.role), offset);
		}
	}
	return { offsetByIncidence, demandByEndpoint };
}
