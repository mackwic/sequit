import { error } from '@sveltejs/kit';

import { isRoomId } from '../../../app/web/ui/document/room-id';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const room: string = params.room;
	if (!isRoomId(room)) error(404, 'Session introuvable');
	return { room };
};
