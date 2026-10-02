import { error } from '@sveltejs/kit';

import { m } from '../../../app/web/i18n/paraglide/messages';
import { isRoomId } from '../../../lib/infrastructure/collaboration/room-id';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const room: string = params.room;
	if (!isRoomId(room)) error(404, m.collaboration_session_not_found());
	return { room };
};
