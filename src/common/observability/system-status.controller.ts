import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface ComponentStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  message?: string;
}

export interface SystemStatusResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  uptimeFormatted: string;
  environment: string;
  version: string;
  nodeVersion: string;
  components: ComponentStatus[];
  memory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
  };
}

@Controller()
export class SystemStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(['system/status', 'status'])
  async getSystemStatus(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SystemStatusResponse | string> {
    const components: ComponentStatus[] = [];

    // 1. Database Check
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      components.push({
        name: 'PostgreSQL Database',
        status: 'healthy',
        latencyMs: Date.now() - dbStart,
        message: 'Connected and responding',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      components.push({
        name: 'PostgreSQL Database',
        status: 'unhealthy',
        latencyMs: Date.now() - dbStart,
        message: `Query failed: ${msg}`,
      });
    }

    // 2. Redis / BullMQ Check
    const redisStart = Date.now();
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = Number(process.env.REDIS_PORT) || 6379;
    try {
      // Fast TCP socket ping to Redis port with 1000ms timeout
      await this.checkTcpConnection(redisHost, redisPort, 1000);
      components.push({
        name: 'Redis / BullMQ Queue',
        status: 'healthy',
        latencyMs: Date.now() - redisStart,
        message: `Connected on ${redisHost}:${redisPort}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      components.push({
        name: 'Redis / BullMQ Queue',
        status: 'degraded',
        latencyMs: Date.now() - redisStart,
        message: `Not reachable: ${msg}`,
      });
    }

    // Determine overall status
    const hasUnhealthy = components.some((c) => c.status === 'unhealthy');
    const hasDegraded = components.some((c) => c.status === 'degraded');
    const overallStatus: 'healthy' | 'degraded' | 'unhealthy' = hasUnhealthy
      ? 'unhealthy'
      : hasDegraded
        ? 'degraded'
        : 'healthy';

    const uptimeSeconds = Math.floor(process.uptime());
    const mem = process.memoryUsage();

    const data: SystemStatusResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      uptimeFormatted: this.formatUptime(uptimeSeconds),
      environment: process.env.NODE_ENV || 'development',
      version: '0.1.0',
      nodeVersion: process.version,
      components,
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      },
    };

    // If request accepts HTML or specifically asks for HTML, render dashboard
    const acceptHeader = req.headers.accept || '';
    const formatQuery = req.query.format;
    if (acceptHeader.includes('text/html') || formatQuery === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return this.renderHtmlDashboard(data);
    }

    return data;
  }

  private checkTcpConnection(host: string, port: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const net = require('node:net');
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`Connection to ${host}:${port} timed out after ${timeoutMs}ms`));
      });

      socket.on('error', (err: Error) => {
        socket.destroy();
        reject(err);
      });

      socket.connect(port, host);
    });
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
  }

  private renderHtmlDashboard(data: SystemStatusResponse): string {
    const statusColor =
      data.status === 'healthy'
        ? '#10b981'
        : data.status === 'degraded'
          ? '#f59e0b'
          : '#ef4444';

    const statusBadge =
      data.status === 'healthy'
        ? 'Operational'
        : data.status === 'degraded'
          ? 'Degraded Performance'
          : 'Major Outage';

    const rows = data.components
      .map((c) => {
        const color =
          c.status === 'healthy'
            ? '#10b981'
            : c.status === 'degraded'
              ? '#f59e0b'
              : '#ef4444';
        return `
        <tr style="border-bottom: 1px solid #374151;">
          <td style="padding: 12px 16px; font-weight: 500;">${c.name}</td>
          <td style="padding: 12px 16px;">
            <span style="display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; background: ${color}22; color: ${color};">
              ${c.status.toUpperCase()}
            </span>
          </td>
          <td style="padding: 12px 16px; font-family: monospace; font-size: 13px;">${c.latencyMs ?? '-'} ms</td>
          <td style="padding: 12px 16px; color: #9ca3af; font-size: 13px;">${c.message || ''}</td>
        </tr>
      `;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Laboura System Status</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #111827; color: #f9fafb; margin: 0; padding: 32px 16px; }
    .container { max-width: 800px; margin: 0 auto; }
    .card { background: #1f2937; border-radius: 8px; border: 1px solid #374151; padding: 24px; margin-bottom: 24px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .status-pill { display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: ${statusColor}; background: ${statusColor}18; padding: 8px 16px; border-radius: 8px; border: 1px solid ${statusColor}44; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: ${statusColor}; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 12px 16px; font-size: 12px; text-transform: uppercase; color: #9ca3af; border-bottom: 1px solid #374151; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
    .meta-item { background: #111827; padding: 12px 16px; border-radius: 6px; border: 1px solid #374151; }
    .meta-label { font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
    .meta-val { font-size: 14px; font-weight: 600; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Laboura Operations</h1>
        <p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 14px;">System Health &amp; Observability Status</p>
      </div>
      <div class="status-pill">
        <span class="dot"></span>
        <span>${statusBadge}</span>
      </div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600;">Core Infrastructure</h2>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Status</th>
            <th>Latency</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600;">Runtime Environment</h2>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">Uptime</div>
          <div class="meta-val">${data.uptimeFormatted}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Heap Memory</div>
          <div class="meta-val">${data.memory.heapUsedMb} MB / ${data.memory.heapTotalMb} MB</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Environment</div>
          <div class="meta-val">${data.environment}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Node Runtime</div>
          <div class="meta-val">${data.nodeVersion}</div>
        </div>
      </div>
    </div>

    <div style="text-align: right; font-size: 12px; color: #6b7280;">
      Last checked: ${data.timestamp} &bull; Version: ${data.version}
    </div>
  </div>
</body>
</html>`;
  }
}
