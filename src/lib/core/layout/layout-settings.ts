export const OUTER_MARGIN = 40;
export const COMPONENT_GAP = 96;
export const ITEM_GAP = 36;
/** Default free space between ordinary rank bands, before local routing reservations. */
export const BASE_RANK_GAP = 72;
/**
 * Free space along the flow between a group frame and the foreign row it faces. A rail crossing
 * that gap runs centered in it, so it keeps 24px on each side, like a junction channel.
 */
export const GROUP_FRAME_CLEARANCE = 48;
/** Leaves at least 24px on each side of a transverse turn, including the arrowhead. */
export const JUNCTION_CLEARANCE = 48;
/** Space for a bridge radius, a 9px arrowhead and 9px of visible air on either side. */
export const JUNCTION_CHANNEL_GAP = 48;
/** Radius of a drawn bridge arc; the arc spans twice this around its crossing point. */
export const BRIDGE_RADIUS = 6;
/** Free ink between an arc and a run end, and between two arcs on one carrier. */
export const BRIDGE_CLEARANCE = 6;
export const JUNCTION_PORT_SPACING = 12;
export const JUNCTION_PORT_INSET = 8;
export const RAIL_SPACING = 24;
/** Minimum visible air between a route parallel to a group frame and that frame. */
export const GROUP_SHELL_CLEARANCE = RAIL_SPACING / 2;
/** Smallest pitch of distinct longitudinal passages in a shared frame strip. */
export const MIN_PASSAGE_SPACING = RAIL_SPACING / 4;
export const PORT_SPACING = 48;
export const PORT_INSET = 24;
