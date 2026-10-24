import { Controller, Get, Header } from '@nestjs/common';
import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';

@Controller()
export class ConsoleController {
  @Get('admin')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdminDashboard(): string {
    return renderAdminDashboardHtml();
  }
}
