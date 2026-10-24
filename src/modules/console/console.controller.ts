import { Controller, Get, Header } from '@nestjs/common';
import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';

@Controller()
export class ConsoleController {
  @Get('admin')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdminDashboard(): string {
    return renderAdminDashboardHtml();
  }

  @Get('call-agent')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getCallAgentConsole(): string {
    return renderCallAgentConsoleHtml();
  }
}
