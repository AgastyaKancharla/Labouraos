import 'reflect-metadata';
import { RequestMethod, Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { AppModule } from '../../app.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from './rbac.guard';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { PERMISSION_METADATA_KEY } from './permissions.decorator';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { RequiredPermission } from './permissions.decorator';
import { normaliseRoutePath, targetFor } from './rbac.guard';
import { ALL_STAFF_ROLES, RBAC_MATRIX, Role } from './rbac.types';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SERVICE_SCOPED_INPUTS, SERVICE_SCOPED_ROUTES } from './service-scoped-routes';
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
  permission: RequiredPermission | undefined;
  controllerPath: string;
  /** Named @Query('x') / @Body('x') inputs, as 'query:x' / 'body:x'. */
  inputs: string[];
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
      permission: (methodPermission ?? classPermission) as RequiredPermission | undefined,
      inputs: ((): string[] => {
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<string, { data?: unknown }>;
        return Object.entries(args).flatMap(([key, arg]) => {
          const type = Number(key.split(':')[0]);
          if (typeof arg.data !== 'string') return [];
          if (type === RouteParamtypes.QUERY) return [`query:${arg.data}`];
          if (type === RouteParamtypes.BODY) return [`body:${arg.data}`];
          return [];
        });
      })(),
      controllerPath: ((): string => {
        const p = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
        return Array.isArray(p) ? p[0] ?? '' : p ?? '';
      })(),
    });
  }
  return routes;
}

/** The proof line is in the spec and a refusal (403/404/thrown) follows within 12 lines. */
function proofHolds(file: string, proof: string): boolean {
  if (!existsSync(file)) return false;
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((line) => line.includes(proof));
  if (at < 0) return false;
  // A refusal, or for a list the proof that another team's rows are left out.
  return lines.slice(at, at + 13).some((line) => /40[34]|toThrow|Forbidden|NotFound|not\.toContain|toEqual\(\[\]\)/.test(line));
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

  it('places the record of every scoped route with an id (own team, own account, own lead fail closed)', () => {
    // A Team Lead (own team), a field agent (own account) or a call agent
    // (own lead) on a record is checked against the record the route
    // declares. A route whose id RbacGuard cannot place would refuse those
    // roles at run time; this finds it before it ships.
    const scoped = new Set(['own_team', 'own_account', 'own_lead']);
    const unplaced: string[] = [];
    // Staff and targets keep their own checks (RbacGuard, by staff id).
    const recordResources = new Set(['job_seeker', 'referral', 'business', 'vacancy', 'placement']);
    for (const route of routes) {
      if (!route.permission || !recordResources.has(route.permission.resource)) continue;
      const action =
        route.permission.action ?? (route.method === 'GET' || route.method === 'HEAD' ? 'read' : 'write');
      const roles = (route.roles.length ? route.roles : ALL_STAFF_ROLES) as Role[];
      const scopedRoles = roles.filter((role) => {
        const rule = RBAC_MATRIX[role]?.[route.permission!.resource]?.[action];
        return rule?.allowed && scoped.has(rule.scope);
      });
      if (scopedRoles.length === 0) continue;
      for (const path of route.paths) {
        const pattern = normaliseRoutePath(`${route.controllerPath}/${path}`);
        if (targetFor(route.permission, pattern) === null) {
          unplaced.push(`${route.method} ${pattern} (${route.controller}.${route.handler}) for ${scopedRoles.join(', ')}`);
        }
      }
    }
    expect(unplaced).toEqual([]);
  });

  it('scopes every route with an id that Team Leads or agents can reach', () => {
    // A path parameter names a record. For a Team Lead, field agent or call
    // agent the route must say which record RbacGuard checks (a permission
    // target, declared or read from the route pattern; a staff or target id),
    // or be listed in SERVICE_SCOPED_ROUTES with the reason and the test that
    // proves the service (or its own guard) scopes it. A route declaring
    // 'none' or 'service' on an id must be listed too.
    const scopedRoles: Role[] = ['team_lead', 'field_agent', 'call_agent'];
    const recordResources = new Set(['job_seeker', 'referral', 'business', 'vacancy', 'placement']);
    const unscoped: string[] = [];
    const listed = new Set(Object.keys(SERVICE_SCOPED_ROUTES));
    const used = new Set<string>();
    for (const route of routes) {
      if (route.publicReason) continue;
      const name = `${route.controller}.${route.handler}`;
      const action =
        route.permission?.action ?? (route.method === 'GET' || route.method === 'HEAD' ? 'read' : 'write');
      const roles = (route.roles.length ? route.roles : ALL_STAFF_ROLES) as Role[];
      const admitted = roles.filter((role) => {
        if (!scopedRoles.includes(role)) return false;
        if (!route.permission) return true;
        return Boolean(RBAC_MATRIX[role]?.[route.permission.resource]?.[action]?.allowed);
      });
      if (admitted.length === 0) continue;
      for (const path of route.paths) {
        const pattern = normaliseRoutePath(`${route.controllerPath}/${path}`) ?? '';
        if (!pattern.includes(':')) continue;
        if (listed.has(name)) {
          used.add(name);
          continue;
        }
        const permission = route.permission;
        let covered = false;
        if (permission && recordResources.has(permission.resource)) {
          const spec = targetFor(permission, pattern);
          covered = spec !== null && spec !== 'none' && spec !== 'service';
        } else if (permission && (permission.resource === 'staff' || permission.resource === 'target')) {
          covered = !permission.target && /\/:(id|staffId)(\/|$)/.test(pattern);
        }
        if (!covered) unscoped.push(`${route.method} ${pattern} (${name}) for ${admitted.join(', ')}`);
      }
    }
    expect(unscoped).toEqual([]);
    // Every listed route still exists, gives a reason and names a test that exists.
    expect([...listed].filter((name) => !used.has(name))).toEqual([]);
    for (const [name, entry] of Object.entries(SERVICE_SCOPED_ROUTES)) {
      expect([name, entry.reason.trim().length > 10]).toEqual([name, true]);
      const file = join(__dirname, '..', '..', entry.test);
      expect([name, existsSync(file)]).toEqual([name, true]);
      // The line that proves it is still in that spec, followed within a few
      // lines by the refusal it describes (a 403/404 or a thrown refusal).
      expect([name, proofHolds(file, entry.proof)]).toEqual([name, true]);
    }
    // Every proof names its own route: no two entries share one.
    const proofs = Object.values(SERVICE_SCOPED_ROUTES).map((entry) => entry.proof);
    expect(proofs.filter((proof, i) => proofs.indexOf(proof) !== i)).toEqual([]);
  });

  it('scopes every staff or record id taken from the query or body (Team Leads and agents)', () => {
    // An id in ?staffId= or a body field names a record just like a path
    // parameter. The route must check it through a permission target that
    // reads that input, or be listed in SERVICE_SCOPED_INPUTS with a reason.
    const scopedRoles: Role[] = ['team_lead', 'field_agent', 'call_agent'];
    const idInput = /(Id|Ids|Ref)$/;
    const unscoped: string[] = [];
    const used = new Set<string>();
    for (const route of routes) {
      if (route.publicReason) continue;
      const name = `${route.controller}.${route.handler}`;
      const roles = (route.roles.length ? route.roles : ALL_STAFF_ROLES) as Role[];
      const action =
        route.permission?.action ?? (route.method === 'GET' || route.method === 'HEAD' ? 'read' : 'write');
      const admitted = roles.filter((role) => scopedRoles.includes(role) && (!route.permission || RBAC_MATRIX[role]?.[route.permission.resource]?.[action]?.allowed));
      if (admitted.length === 0) continue;
      const target = route.permission?.target;
      const declared = new Set(
        (Array.isArray(target) ? target : target && typeof target === 'object' ? [target] : [])
          .map((t) => t.from.replace(/\[\]$/, '')),
      );
      for (const input of route.inputs) {
        if (!idInput.test(input.split(':')[1] ?? '')) continue;
        if (declared.has(input)) continue;
        const key = `${name} ${input}`;
        if (SERVICE_SCOPED_INPUTS[key]) {
          used.add(key);
          continue;
        }
        unscoped.push(`${route.method} ${route.paths.join(' | ')} ${input} (${name}) for ${admitted.join(', ')}`);
      }
    }
    expect(unscoped).toEqual([]);
    expect(Object.keys(SERVICE_SCOPED_INPUTS).filter((key) => !used.has(key))).toEqual([]);
    for (const [key, entry] of Object.entries(SERVICE_SCOPED_INPUTS)) {
      expect([key, entry.reason.trim().length > 10]).toEqual([key, true]);
      expect([key, proofHolds(join(__dirname, '..', '..', entry.test), entry.proof)]).toEqual([key, true]);
    }
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

  it('lets only the CEO lift a permanent ban or a suspension (M7, rev 178); Manager or CEO ban and cancel an unpaid replacement', () => {
    const rolesOf = (name: string) => routes.find((route) => `${route.controller}.${route.handler}` === name)?.roles.slice().sort();
    expect(rolesOf('ConductController.liftBan')).toEqual(['ceo']);
    expect(rolesOf('ConductController.lift')).toEqual(['ceo']);
    expect(rolesOf('ConductController.suspend')).toEqual(['ceo']);
    expect(rolesOf('ConductController.ban')).toEqual(['ceo', 'manager']);
    expect(rolesOf('PlacementController.cancelUpgrade')).toEqual(['ceo', 'manager']);
    expect(rolesOf('PlacementController.suspendedBusinessClaims')).toEqual(['ceo', 'manager']);
  });

  it('keeps the proxy check (GET /health/proxy-check) behind a login, for the CEO only', () => {
    const route = routes.find((r) => r.controller === 'HealthController' && r.handler === 'proxyCheck');
    expect(route).toBeDefined();
    expect(route!.publicReason).toBeUndefined();
    expect(route!.guards).toEqual(expect.arrayContaining([JwtAuthGuard, RbacGuard]));
    expect(route!.roles).toEqual(['ceo']);
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
      'HealthController.proxyCheck',
    ]) {
      expect(publicPaths).not.toContain(forbidden);
    }
  });
});
