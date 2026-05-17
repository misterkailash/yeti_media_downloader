// GET /api/image-proxy/<filename>?url=<allowed-host>&inline=1
// Path-form variant of /api/image-proxy. Used as the avatar src so Chrome
// uses the URL path as the default "Save image as" name (more reliable
// than relying on Content-Disposition headers across browsers).
import { handleImageProxy } from '../../utils/image-proxy.js';

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  await handleImageProxy({
    target: q.url,
    name: q.name || getRouterParam(event, 'filename') || null,
    inline: q.inline === '1',
    res: event.node.res,
  });
});
