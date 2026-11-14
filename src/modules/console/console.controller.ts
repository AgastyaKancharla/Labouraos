import { Controller, Get, Header } from '@nestjs/common';
import { renderSetupPageHtml } from './templates/setup-page.html';
import { Public } from '../../common/rbac/public.decorator';

/**
 * What is left of the old one-page consoles (retired 14 Nov; AGENTS.md,
 * "Retired consoles"): only the first-CEO set-up page. The office web app
 * (/login, /ceo, /call-agent …) and Laboura Field replaced the rest; a
 * browser opening an old address (/admin, /console/admin, /map,
 * /field-agent, /console/call-agent …) is redirected by SiteRoutingMiddleware.
 */
@Controller()
export class ConsoleController {
  /**
   * The first-CEO set-up page (DEPLOY.md, Step 7): the bootstrap secret and
   * the first password go from this page to POST /staff/bootstrap on the same
   * address, never through a third-party site.
   */
  @Get('setup')
  @Public('first CEO set-up page shell only; the bootstrap request behind it needs STAFF_BOOTSTRAP_SECRET and an empty Staff table')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Frame-Options', 'DENY')
  @Header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
  getSetupPage(): string {
    return renderSetupPageHtml();
  }
}
