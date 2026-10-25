import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';
import { CloudflareAccessGuard } from '../../common/auth/cloudflare-access.guard';

@Controller()
export class ConsoleController {
  @Get('admin')
  @UseGuards(CloudflareAccessGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdminDashboard(): string {
    return renderAdminDashboardHtml();
  }

  @Get('call-agent')
  @UseGuards(CloudflareAccessGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  getCallAgentConsole(): string {
    return renderCallAgentConsoleHtml();
  }

  @Get('field-agent')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getFieldAgentApp(): string {
    return renderFieldAgentAppHtml();
  }
}
