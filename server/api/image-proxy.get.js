// GET /api/image-proxy?url=<allowed-host>&name=<basename>&inline=1
// Used by every thumbnail in the frontend. See lib/image-proxy.js for the
// streaming + magic-byte validation logic.
import { handleImageProxy } from '../utils/image-proxy.js';

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  await handleImageProxy({
    target: q.url,
    name: q.name || null,
    inline: q.inline === '1',
    res: event.node.res,
  });
});
