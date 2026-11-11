import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE_KEY = 'rbac_public_route';

/**
 * Marks a route as reachable without a staff login, on purpose. Every route
 * must carry either a role guard or this marker; route-guard-coverage.spec.ts
 * fails the build otherwise. Use it only for webhooks (which check their own
 * signature), token pages for job seekers, businesses and referral partners,
 * login and bootstrap, health and the public status answer, and the console
 * page shells. The reason is required so a reviewer can see why.
 */
export const Public = (reason: string) => SetMetadata(PUBLIC_ROUTE_KEY, reason);
