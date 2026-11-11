import { Controller, Get, NotFoundException, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../../common/rbac/public.decorator';
import { resolveFieldAppFile, resolveFieldDistDir } from './field-app.files';

/**
 * Serves Laboura Field, the field agent phone app built with Expo
 * (field/), as an installable web app at /field: its static files, the web
 * manifest and service worker, and index.html for every screen URL so the
 * app's router can take over.
 *
 * Open like the old /field-agent console: field agents use their own phones
 * outside the office, so Cloudflare Access does not apply. The files hold no
 * data — every data call needs a staff login (JWT) and passes RBAC.
 *
 * Nothing else is touched: /field-agent (the old console) keeps working.
 */
@Controller()
export class FieldAppController {
  @Get(['field', 'field/*path'])
  @Public('static files of the Laboura Field phone app; they hold no data and every API call needs a staff login')
  serve(@Req() req: Request, @Res() res: Response): void {
    const distDir = resolveFieldDistDir();
    if (!distDir) {
      throw new ServiceUnavailableException('Laboura Field has not been built yet (npm run field:build-web).');
    }
    const file = resolveFieldAppFile(distDir, req.path);
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
    if (file.serviceWorker) res.setHeader('Service-Worker-Allowed', '/field/');
    res.setHeader(
      'Cache-Control',
      file.cache === 'immutable' ? 'public, max-age=31536000, immutable' : file.cache === 'fresh' ? 'no-cache' : 'public, max-age=3600',
    );
    const headers: Record<string, string> = {};
    if (file.absolutePath.endsWith('.webmanifest')) headers['Content-Type'] = 'application/manifest+json';
    res.sendFile(file.absolutePath, { headers });
  }
}
