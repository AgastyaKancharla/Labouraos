import { Controller, Get, NotFoundException, Req, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { CloudflareAccessGuard } from '../../common/auth/cloudflare-access.guard';
import { resolveWebAppFile, resolveWebDistDir } from './web-app.files';
import { Public } from '../../common/rbac/public.decorator';

/**
 * Serves the React app (web/) at /app: its static files, and index.html for
 * every screen URL so the browser router can take over (SPA fallback).
 *
 * The staff portals sit behind the same Cloudflare Access check as the old
 * /admin and /call-agent consoles (off unless CLOUDFLARE_ACCESS_ENFORCED is
 * true). The public job seeker pages (/app/p/...) and the static assets they
 * need are open. Data is protected by the API's JWT and RBAC on every
 * request either way — these files contain no data.
 *
 * Nothing outside /app is touched: API routes and the old consoles keep
 * working until their screens are replaced.
 */
@Controller()
export class WebAppController {
  @Get(['app/p', 'app/p/*path', 'app/assets/*path', 'app/favicon.png', 'app/logo-mark.png'])
  @Public('static files of the public job seeker pages; they hold no data')
  servePublic(@Req() req: Request, @Res() res: Response): void {
    this.send(req, res);
  }

  @Get(['app', 'app/*path'])
  @UseGuards(CloudflareAccessGuard)
  @Public('static staff app files behind Cloudflare Access; every data call needs a staff login')
  serveStaff(@Req() req: Request, @Res() res: Response): void {
    this.send(req, res);
  }

  private send(req: Request, res: Response): void {
    const distDir = resolveWebDistDir();
    if (!distDir) {
      throw new ServiceUnavailableException('The web app has not been built yet (npm run web:build).');
    }
    const file = resolveWebAppFile(distDir, req.path);
    if (file.kind === 'missing') {
      throw new NotFoundException('File not found');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (file.kind === 'index') {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Frame-Options', 'DENY');
      res.sendFile(file.absolutePath, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return;
    }
    res.setHeader('Cache-Control', file.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    res.sendFile(file.absolutePath);
  }
}
