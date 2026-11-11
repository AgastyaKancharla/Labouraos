import 'reflect-metadata';
import { RequestMethod, Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AppModule } from '../../app.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from './rbac.guard';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { PERMISSION_METADATA_KEY } from './permissions.decorator';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { PaymentReceiptGuard } from '../../modules/payment/payment-receipt.guard';

/**
 * Walks every route the application registers and fails when a route has
 * neither a role guard nor an explicit @Public() marker. A new screen's
 * endpoint can therefore never ship open by accident.
 *
 * A role guard means: a guard that authenticates the staff member
 * (JwtAuthGuard, or a guard that falls back to it), a guard that enforces
 * roles (RbacGuard, or a guard that wraps it), and a @RequireRoles or
 * @RequirePermission list for it to enforce.
 */

const AUTHENTICATING_GUARDS: unknown[] = [JwtAuthGuard, PaymentReceiptGuard];
const ROLE_ENFORCING_GUARDS: unknown[] = [RbacGuard, PaymentReceiptGuard];

interface RouteInfo {
  controller: string;
  handler: string;
  method: string;
  paths: string[];
  guards: unknown[];
  hasRoles: boolean;
  roles: string[];
  publicReason: string | undefined;
}

function moduleClass(entry: unknown): Type<unknown> | undefined {
  if (!entry) return undefined;
  if (typeof entry === 'function') return entry as Type<unknown>;
  if (typeof entry === 'object' && 'module' in (entry as Record<string, unknown>)) {
    return (entry as { module: Type<unknown> }).module;
  }
  return undefined;
}

function collectControllers(root: Type<unknown>): Type<unknown>[] {
  const seenModules = new Set<unknown>();
  const controllers = new Set<Type<unknown>>();
  const visit = (entry: unknown) => {
    const cls = moduleClass(entry);
    if (!cls || seenModules.has(entry)) return;
    seenModules.add(entry);
    const imports: unknown[] = [
      ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, cls) as unknown[]) ?? []),
      ...(typeof entry === 'object' ? ((entry as { imports?: unknown[] }).imports ?? []) : []),
    ];
    const own: Type<unknown>[] = [
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, cls) as Type<unknown>[]) ?? []),
      ...(typeof entry === 'object'
        ? ((entry as { controllers?: Type<unknown>[] }).controllers ?? [])
        : []),
    ];
    own.forEach((controller) => controllers.add(controller));
    imports.forEach(visit);
  };
  visit(root);
  return [...controllers];
}

function routesOf(controller: Type<unknown>): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? [];
  const classRoles = Reflect.getMetadata(ROLES_METADATA_KEY, controller) as unknown[] | undefined;
  const classPermission = Reflect.getMetadata(PERMISSION_METADATA_KEY, controller);
  const proto = controller.prototype as Record<string, unknown>;
  const names = new Set<string>();
  for (let p: object | null = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    Object.getOwnPropertyNames(p).forEach((name) => names.add(name));
  }
  for (const name of names) {
    if (name === 'constructor') continue;
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    const rawPath = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
    const methodRoles = Reflect.getMetadata(ROLES_METADATA_KEY, handler) as unknown[] | undefined;
    const methodPermission = Reflect.getMetadata(PERMISSION_METADATA_KEY, handler);
    const roles = methodRoles ?? classRoles;
    routes.push({
      controller: controller.name,
      handler: name,
      method: RequestMethod[method],
      paths: Array.isArray(rawPath) ? rawPath : [rawPath ?? ''],
      guards: [
        ...classGuards,
        ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
      ],
      hasRoles:
        (Array.isArray(roles) && roles.length > 0) || Boolean(methodPermission ?? classPermission),
      roles: Array.isArray(roles) ? (roles as string[]) : [],
      // Only a marker on the route itself counts, so a new route added to a
      // controller of public pages is not public by accident.
      publicReason: Reflect.getMetadata(PUBLIC_ROUTE_KEY, handler) as string | undefined,
    });
  }
  return routes;
}

function describeRoute(route: RouteInfo): string {
  return `${route.method} ${route.paths.join(' | ')} (${route.controller}.${route.handler})`;
}

describe('every route has a role guard or an explicit @Public() marker', () => {
  const controllers = collectControllers(AppModule);
  const routes = controllers.flatMap(routesOf);

  it('finds the application routes', () => {
    expect(controllers.length).toBeGreaterThan(30);
    expect(routes.length).toBeGreaterThan(200);
  });

  it('leaves no route open by accident', () => {
    const unguarded = routes
      .filter((route) => !route.publicReason)
      .filter((route) => {
        const authenticates = route.guards.some((g) => AUTHENTICATING_GUARDS.includes(g));
        const enforcesRoles = route.guards.some((g) => ROLE_ENFORCING_GUARDS.includes(g));
        return !(authenticates && enforcesRoles && route.hasRoles);
      })
      .map(describeRoute);
    expect(unguarded).toEqual([]);
  });

  it('gives every public route a reason', () => {
    const blank = routes
      .filter((route) => route.publicReason !== undefined && !route.publicReason.trim())
      .map(describeRoute);
    expect(blank).toEqual([]);
  });

  it('never lets a Manager onto a money route (payments, refunds, pricing, invoices)', () => {
    // A Manager sees no money at all (Master Guide, reconfirmed 11 Nov).
    // Resending a payment link shows no amount (answers to a Manager are
    // stripped of money fields), so it is an exception. So is the close-to-refund
    // list (Phase 21 Task 7): the guide gives Managers their tree's list and
    // counts without rupees, and the service leaves every rupee field out.
    const allowedForManager = new Set(['PaymentController.resendPayment', 'RefundPriorityController.list']);
    const moneyControllers = new Set(['PaymentController', 'RefundController', 'PricingController']);
    const leaks = routes
      .filter(
        (route) =>
          moneyControllers.has(route.controller) ||
          route.paths.some((path) => /invoice|receipt|refund|payout/i.test(path)),
      )
      .filter((route) => route.roles.includes('manager'))
      .map((route) => `${route.controller}.${route.handler}`)
      .filter((name) => !allowedForManager.has(name));
    expect(leaks).toEqual([]);
  });

  it('keeps money, audit and staff routes behind a login', () => {
    const publicPaths = routes
      .filter((route) => route.publicReason)
      .map((route) => `${route.controller}.${route.handler}`);
    for (const forbidden of [
      'PaymentController.getPaymentReceipt',
      'PaymentController.findAll',
      'AuditController.getAuditLogs',
      'EditPolicyController.checkEditPermission',
      'SystemStatusController.getSystemStatus',
    ]) {
      expect(publicPaths).not.toContain(forbidden);
    }
  });
});
