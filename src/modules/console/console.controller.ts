import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';
import { renderMapPageHtml } from './templates/map.html';
import { CloudflareAccessGuard } from '../../common/auth/cloudflare-access.guard';
import { Public } from '../../common/rbac/public.decorator';

@Controller()
export class ConsoleController {
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
