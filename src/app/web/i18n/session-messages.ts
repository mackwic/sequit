import {
	TopologyEditDiagnosticCode,
	type TopologyEditReason,
} from '../../../lib/core/document/topology-edit-ordering';
import {
	BusinessCommandRefusal,
	RetryableSessionFailure,
	SessionNoticeError,
	TerminalSessionFailure,
} from '../../../lib/infrastructure/collaboration/session-failure';
import {
	CommandRefusalCode,
	type PLAIN_COMMAND_REFUSAL_CODES,
	SessionFailureCode,
	type SessionNotice,
	SessionNoticeCode,
	type SessionReason,
} from '../../../lib/infrastructure/collaboration/session-reasons';
import { DocumentSessionError } from '../../../lib/infrastructure/document/document-session-contracts';
import {
	SharedElementKind,
	type SharedTarget,
} from '../../../lib/infrastructure/document/shared-document-command';
import { m } from './paraglide/messages';

/** Reasons the interface explains: from the session, or from a local topology edit check. */
type TranslatableReason = SessionReason | TopologyEditReason;

type PlainRefusalCode = (typeof PLAIN_COMMAND_REFUSAL_CODES)[number];

const plainRefusalMessages: Readonly<Record<PlainRefusalCode, () => string>> = {
	[CommandRefusalCode.IdentifierExists]: m.diagnostics_identifier_exists,
	[CommandRefusalCode.GroupMemberMissing]: m.diagnostics_group_member_missing,
	[CommandRefusalCode.ElementsDifferentRegion]: m.diagnostics_elements_different_region,
	[CommandRefusalCode.ElementsDifferentLane]: m.diagnostics_elements_different_lane,
	[CommandRefusalCode.GroupSelectionRequired]: m.diagnostics_group_selection_required,
	[CommandRefusalCode.ElementsDifferentGroup]: m.diagnostics_elements_different_group,
	[CommandRefusalCode.NatureReplacementRequired]: m.diagnostics_nature_replacement_required,
	[CommandRefusalCode.NatureReplacementDifferent]: m.diagnostics_nature_replacement_different,
	[CommandRefusalCode.UnknownCommand]: m.diagnostics_unknown_command,
	[CommandRefusalCode.DocumentMissing]: m.diagnostics_document_missing,
	[CommandRefusalCode.MinimumLanes]: m.diagnostics_minimum_lanes,
	[CommandRefusalCode.LaneNameRequired]: m.diagnostics_lane_name_required,
	[CommandRefusalCode.RegionalLanesRequired]: m.diagnostics_regional_lanes_required,
	[CommandRefusalCode.NodesDifferentLane]: m.diagnostics_nodes_different_lane,
	[CommandRefusalCode.NodesDifferentRegion]: m.diagnostics_nodes_different_region,
	[CommandRefusalCode.InvalidRegionPresentation]: m.diagnostics_invalid_region_presentation,
	[CommandRefusalCode.GroupSelfContainment]: m.diagnostics_group_self_containment,
};

function isPlainRefusal(
	reason: TranslatableReason,
): reason is Extract<TranslatableReason, { readonly code: PlainRefusalCode }> {
	return Object.hasOwn(plainRefusalMessages, reason.code);
}

function isSessionNotice(reason: TranslatableReason): reason is SessionNotice {
	return Object.values<string>(SessionNoticeCode).includes(reason.code);
}

/** A translated sentence followed by the technical details it summarizes, which stay untranslated. */
function withDetails(message: string, details: readonly string[]): string {
	if (details.length === 0) return message;
	return `${message} ${details.join('; ')}`;
}

function unsentTextAbandoned(target: SharedTarget): string {
	switch (target.kind) {
		case SharedElementKind.Node:
			return m.diagnostics_unsent_box_abandoned({ id: target.id });
		case SharedElementKind.Group:
			return m.diagnostics_unsent_group_abandoned({ id: target.id });
		case SharedElementKind.Nature:
			return m.diagnostics_unsent_nature_abandoned({ id: target.id });
		case SharedElementKind.Document:
		case SharedElementKind.Junction:
		case SharedElementKind.Relation:
			return m.diagnostics_unsent_text_abandoned({ kind: target.kind, id: target.id });
		default: {
			const unhandled: never = target.kind;
			throw new Error(`Unhandled shared target kind: ${String(unhandled)}`);
		}
	}
}

function translateSessionNotice(notice: SessionNotice): string {
	switch (notice.code) {
		case SessionNoticeCode.ActionRefused:
			return m.diagnostics_action_refused({
				id: notice.id,
				reason: translateSessionReason(notice.reason),
			});
		case SessionNoticeCode.UnacknowledgedTitleAbandoned:
			return m.diagnostics_unacknowledged_title_abandoned();
		case SessionNoticeCode.UnacknowledgedNodesAbandoned:
			return m.diagnostics_unacknowledged_nodes_abandoned({ nodeIds: notice.nodeIds.join(', ') });
		case SessionNoticeCode.UnsentTextAbandoned:
			return unsentTextAbandoned(notice.target);
		case SessionNoticeCode.SynchronizationFailed:
			return m.diagnostics_synchronization_failed({
				reason: translateSessionReason(notice.reason),
			});
		case SessionNoticeCode.ConnectionRequired:
			return m.diagnostics_connection_required();
		case SessionNoticeCode.InvalidMessage:
			return m.diagnostics_session_invalid_message();
		case SessionNoticeCode.Destroyed:
			return m.diagnostics_session_destroyed();
		case SessionNoticeCode.NodeNotFound:
			return m.diagnostics_node_not_found({ nodeId: notice.nodeId });
		case SessionNoticeCode.NodeMarkdownUnavailable:
			return m.diagnostics_node_markdown_unavailable({ nodeId: notice.nodeId });
		default: {
			const unhandled: never = notice;
			throw new Error(`Unhandled session notice: ${String(unhandled)}`);
		}
	}
}

/** Converts structured collaboration reasons into user-facing messages in the active locale. */
export function translateSessionReason(reason: TranslatableReason): string {
	if (isPlainRefusal(reason)) return plainRefusalMessages[reason.code]();
	if (isSessionNotice(reason)) return translateSessionNotice(reason);
	switch (reason.code) {
		case CommandRefusalCode.InvalidDocument:
		case SessionFailureCode.InvalidDocument:
			return withDetails(m.diagnostics_invalid_document(), reason.details);
		case SessionFailureCode.InvalidMessage:
			return withDetails(m.diagnostics_invalid_message(), reason.details);
		case CommandRefusalCode.ElementMissing:
			return m.diagnostics_element_missing();
		case CommandRefusalCode.InvalidLaneId:
			return m.diagnostics_invalid_lane_id({ laneId: reason.laneId });
		case CommandRefusalCode.UnknownDestinationLane:
			return m.diagnostics_unknown_destination_lane({ target: reason.target });
		case CommandRefusalCode.GroupMissing:
			return m.diagnostics_group_missing();
		case TopologyEditDiagnosticCode.DuplicateRelationId:
		case CommandRefusalCode.DuplicateRelationId:
			return m.diagnostics_duplicate_relation_id({ relationId: reason.relationId });
		case TopologyEditDiagnosticCode.DuplicateRelation:
		case CommandRefusalCode.DuplicateRelation:
			return m.diagnostics_duplicate_relation({
				from: reason.from,
				to: reason.to,
				relationId: reason.relationId,
			});
		case SessionFailureCode.StorageUnavailable:
			return m.diagnostics_storage_unavailable();
		case SessionFailureCode.CommandGap:
			return m.diagnostics_command_gap();
		case SessionFailureCode.CorruptCommandReceipt:
			return m.diagnostics_corrupt_command_receipt({ sessionId: reason.sessionId });
		case SessionFailureCode.RepeatedCommandRefusal:
			return m.diagnostics_repeated_command_refusal();
		default: {
			const unhandled: never = reason;
			throw new Error(`Unhandled session reason: ${String(unhandled)}`);
		}
	}
}

/** Translates command refusals while retaining validation diagnostics as technical details. */
export function translateCommandDiagnostics(
	diagnostics: readonly { readonly reason?: TranslatableReason; readonly message: string }[],
): string {
	return diagnostics
		.map(({ reason, message }) => {
			if (reason === undefined) return withDetails(m.diagnostics_invalid_document(), [message]);
			return translateSessionReason(reason);
		})
		.join('; ');
}

/** Translates typed session errors, leaving unexpected English error details visible. */
export function translateSessionError(error: unknown): string {
	if (error instanceof DocumentSessionError) return translateSessionReason(error.reason);
	if (error instanceof SessionNoticeError) return translateSessionReason(error.reason);
	if (error instanceof BusinessCommandRefusal) return translateSessionReason(error.reason);
	if (error instanceof RetryableSessionFailure || error instanceof TerminalSessionFailure)
		return translateSessionReason(error.reason);
	if (error instanceof Error) return m.diagnostics_unexpected_failure({ details: error.message });
	return m.diagnostics_unexpected_failure({ details: String(error) });
}
