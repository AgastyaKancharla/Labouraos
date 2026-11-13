import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { SiteRoutingMiddleware } from './site-routing.middleware';

/**
 * The office web app (web/) and Laboura Field (field/) are served by this
 * service next to the API, chosen by host and path (SiteRoutingMiddleware):
 * app.laboura.com has the portals at the root, field.laboura.com (FIELD_HOST)
 * has Laboura Field at the root, and any other address (the Render test
 * address) has the portals at the root and Laboura Field at /field.
 */
@Module({
  providers: [SiteRoutingMiddleware],
})
export class WebAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SiteRoutingMiddleware).forRoutes('*');
  }
}
