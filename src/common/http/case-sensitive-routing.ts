import * as express from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';

/**
 * The HTTP adapter the API runs on, with case-sensitive routing.
 *
 * Express matches routes regardless of letter case by default, so
 * /Job-Seekers/:id reached the /job-seekers/:id handler. Every address the
 * API, the office web app, Laboura Field, public links and webhooks use is
 * lowercase, so a different spelling now answers 404 instead of reaching a
 * route by a path nothing checks. (RbacGuard also reads the declared route
 * pattern, never the raw URL, so letter case cannot change what it checks.)
 *
 * The setting must be made before Express builds its router, which happens on
 * the first app.use / route, so the Express app is created here and handed
 * to Nest.
 */
export function caseSensitiveHttpAdapter(): ExpressAdapter {
  const server = express();
  server.set('case sensitive routing', true);
  return new ExpressAdapter(server);
}
