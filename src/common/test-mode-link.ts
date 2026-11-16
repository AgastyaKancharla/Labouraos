import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Stream } from 'stream';
import { isTestSetup } from './customer-auth/customer-otp-test-mode';
import { anyLiveVendor, otpTestModeEnabled } from './otp/otp-test-mode';

/**
 * Test-mode links (hosted test site only). Staff routes never return a public
 * link's token (security AC-3): the link reaches the person by SMS. On the
 * test site every vendor is pretend, so no SMS arrives and nobody could open a
 * registration, agreement, partner terms, payout-details, vacancy
 * confirmation or payment-only link. There, and only there, the answer to the
 * request that sent such an SMS carries the full link as `testModeLink`, and
 * the yellow test-mode banner offers "Open link" (DEPLOY.md F12).
 *
 * ON only when all of these hold:
 *   - the setup is explicitly the test setup (LABOURA_SETUP=test);
 *   - OTP test mode is on (the same gate that shows "Test mode code");
 *   - no vendor at all is live (SMS, OTP, WhatsApp, payment, telephony are
 *     all mock), whatever NODE_ENV says.
 * LABOURA_SETUP=live, an unset LABOURA_SETUP (the default production config)
 * or any real vendor turns it off, so a live system never hands a token out.
 */
export function testModeLinkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTestSetup(env) && otpTestModeEnabled(env) && !anyLiveVendor(env);
}

export interface TestModeLink {
  /** The SMS template that carried the link (consent_link, agreement_link…). */
  template: string;
  url: string;
}

export interface TestModeLinkFields {
  /** The full link of the first SMS this request sent, only in test mode. */
  testModeLink?: string;
  /** Every link this request sent, when it sent more than one. */
  testModeLinks?: TestModeLink[];
}

interface LinkStore {
  links: TestModeLink[];
}

const store = new AsyncLocalStorage<LinkStore>();

/**
 * Called by MessagingService for every message it sends: remembers the link
 * for the current request when test-mode links are on. Outside a request (jobs)
 * or on a live system it does nothing.
 */
export function recordTestModeLink(template: string, url: unknown, env: NodeJS.ProcessEnv = process.env): void {
  const current = store.getStore();
  if (!current || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  if (!testModeLinkEnabled(env)) return;
  current.links.push({ template, url });
}

/** Runs `fn` collecting the links it sends (test-mode only; used by the interceptor and tests). */
export function collectTestModeLinks<T>(fn: () => T): { links: TestModeLink[]; result: T } {
  const current: LinkStore = { links: [] };
  const result = store.run(current, fn);
  return { links: current.links, result };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value instanceof StreamableFile || value instanceof Stream || ArrayBuffer.isView(value) || value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** What an answer adds: nothing unless test-mode links are on and the request sent a link. */
export function withTestModeLinks<T>(body: T, links: readonly TestModeLink[], env: NodeJS.ProcessEnv = process.env): T {
  if (!links.length || !isPlainObject(body) || !testModeLinkEnabled(env)) return body;
  const fields: TestModeLinkFields = { testModeLink: links[0].url };
  if (links.length > 1) fields.testModeLinks = links.map((link) => ({ ...link }));
  return { ...body, ...fields } as T;
}

/**
 * Global interceptor (registered by MessageModule): in test mode, runs the
 * handler with a link collector and adds `testModeLink` to its JSON answer.
 * On a live system it is a straight pass-through.
 */
@Injectable()
export class TestModeLinkInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !testModeLinkEnabled()) return next.handle();
    return new Observable<unknown>((subscriber) => {
      const current: LinkStore = { links: [] };
      // next.handle() binds the handler to the async context it is called in.
      const subscription = store.run(current, () =>
        next
          .handle()
          .pipe(map((body) => withTestModeLinks(body, current.links)))
          .subscribe(subscriber),
      );
      return () => subscription.unsubscribe();
    });
  }
}
