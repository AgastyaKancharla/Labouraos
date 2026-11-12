import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';
import { renderMapPageHtml } from './templates/map.html';
import { renderSetupPageHtml } from './templates/setup-page.html';
import { CloudflareAccessGuard } from '../../common/auth/cloudflare-access.guard';
import { Public } from '../../common/rbac/public.decorator';

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

  @Get(['map', 'console/map'])
  @Public('console page shell only; every data call behind it needs a staff login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getMap(): string {
    return renderMapPageHtml();
  }

  @Get(['admin', 'console/admin'])
  @Public('console page shell only; every data call behind it needs a staff login')
  @UseGuards(CloudflareAccessGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdminDashboard(): string {
    return renderAdminDashboardHtml();
  }

  @Get(['call-agent', 'console/call-agent'])
  @Public('console page shell only; every data call behind it needs a staff login')
  @UseGuards(CloudflareAccessGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  getCallAgentConsole(): string {
    return renderCallAgentConsoleHtml();
  }

  @Get(['field-agent', 'console/field-agent'])
  @Public('console page shell only; every data call behind it needs a staff login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getFieldAgentApp(): string {
    return renderFieldAgentAppHtml();
  }
}
