import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderSetupPageHtml } from './templates/setup-page.html';
import { CloudflareAccessGuard } from '../../common/auth/cloudflare-access.guard';
import { Public } from '../../common/rbac/public.decorator';

/**
 * What is left of the old one-page consoles (retired 14 Nov; AGENTS.md,
 * "Retired consoles"). The office web app (/login, /ceo, /call-agent …) and
 * Laboura Field replaced them; a browser opening an old address (/admin,
 * /map, /field-agent, /console/call-agent …) is redirected by
 * SiteRoutingMiddleware before it reaches this controller.
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

  /**
   * The old Admin Dashboard, kept only at this address until the new screens
   * cover what only it still does: recording a bank credit by hand from the
   * statement, setting a bank credit aside, Finance resolving payment and
   * payout flags, and reporting a replacement claim. /admin itself now goes to
   * /login.
   */
  @Get('console/admin')
  @Public('console page shell only; every data call behind it needs a staff login')
  @UseGuards(CloudflareAccessGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdminDashboard(): string {
    return renderAdminDashboardHtml();
  }
}
