import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { HelmetOptions } from 'helmet';
import { API_PREFIX } from '../config/api';

/**
 * One explicit Content-Security-Policy for the API and the UI (ADR-0017). Same origin only;
 * `blob:` images for the logo, which is fetched with a token and shown through an object URL.
 * Helmet's `upgrade-insecure-requests` is dropped: the app is plain http on 127.0.0.1, where
 * upgrading would break every request.
 */
export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  // Dialog/scroll-lock libraries inject <style> elements; scripts stay strict.
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'blob:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  upgradeInsecureRequests: null,
} as const;

export const HELMET_OPTIONS: HelmetOptions = {
  contentSecurityPolicy: { useDefaults: false, directives: CSP_DIRECTIVES },
  // http on loopback: HSTS would pin a scheme the app does not use.
  strictTransportSecurity: false,
};

const API_ROOT = `/${API_PREFIX.split('/')[0]}`; // "/api": API routes and the dev OpenAPI UI

/**
 * Serves the built UI from `distDir`: hashed files under /assets are cached forever, everything
 * else is revalidated, and any other GET outside /api returns index.html so client routes
 * (e.g. /cases/12) survive a reload. Unknown /api paths still get the JSON 404 envelope;
 * missing files outside /api get a bare 404.
 */
export function serveWebApp(app: NestExpressApplication, distDir: string): void {
  const indexFile = path.join(distDir, 'index.html');
  app.useStaticAssets(distDir, {
    index: false,
    fallthrough: true,
    redirect: false,
    setHeaders: (res: Response, filePath: string) => {
      const hashed = filePath.startsWith(path.join(distDir, 'assets') + path.sep);
      res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isApi = req.path === API_ROOT || req.path.startsWith(`${API_ROOT}/`);
    const wantsPage = (req.method === 'GET' || req.method === 'HEAD') && !path.extname(req.path);
    if (isApi) return next();
    // A missing file (or a non-GET outside /api) is a plain 404, never the page and never Express's HTML.
    if (!wantsPage) return void res.sendStatus(404);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
}
