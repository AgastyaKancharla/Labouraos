import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { PUBLIC_ROUTE_KEY } from '../rbac/public.decorator';
import { CUSTOMER_ERROR_CODES } from '../customer-auth/customer-auth.errors';

/**
 * INF-6 (with IN-3): business names, localities and person names may not start
 * with = + - or @. Such a value is how a spreadsheet formula gets into a CSV
 * download ("=HYPERLINK(...)" as a business name). The CSV files already write
 * such a cell as text (src/common/csv/csv-cell.ts); this refuses it at input
 * too, on every staff, public-link and customer app request, with a clear
 * message, so it is never stored.
 *
 * Checked: JSON request bodies (POST, PUT, PATCH), at any depth up to 5 levels,
 * for the keys below. Webhooks are skipped (a vendor's payload is never refused
 * for a name: its money or call must still be recorded), and so are multipart
 * uploads (no upload form carries a name or locality).
 */
export const FORMULA_START_FIELDS: Readonly<Record<string, string>> = {
  name: 'Name',
  fullName: 'Name',
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  familyName: 'Family name',
  displayName: 'Name',
  businessName: 'Business name',
  boardName: 'Business name',
  legalName: 'Legal name',
  companyLegalName: 'Legal name',
  tradeName: 'Trade name',
  shopName: 'Shop name',
  branchName: 'Branch name',
  ownerName: "Owner's name",
  contactName: 'Contact name',
  contactPersonName: 'Contact person',
  additionalContactName: 'Contact name',
  interviewContactName: 'Interview contact',
  partnerName: "Partner's name",
  partnerBusinessName: 'Business name',
  billingName: 'Billing name',
  signedName: 'Name',
  typedName: 'Name',
  candidateName: "Candidate's name",
  staffName: 'Staff name',
  teamName: 'Team name',
  nomineeName: "Nominee's name",
  accountHolderName: 'Account holder name',
  holderName: 'Account holder name',
  grievanceOfficerName: "Grievance Officer's name",
  locality: 'Locality',
  area: 'Area',
  city: 'City',
};

export const FORMULA_START_CODE = CUSTOMER_ERROR_CODES.TEXT_STARTS_WITH_SYMBOL;

/** Starts (after spaces) with a character that makes a spreadsheet run the cell. */
export function startsLikeFormula(value: string): boolean {
  return /^[=+\-@]/.test(value.trimStart());
}

const MAX_DEPTH = 5;

/** The first name-like field (path and label) whose text starts like a formula, or null. */
export function findFormulaStart(body: unknown, depth = 0, at = ''): { field: string; label: string } | null {
  if (depth > MAX_DEPTH || body === null || typeof body !== 'object') return null;
  const entries: Array<[string, unknown]> = Array.isArray(body)
    ? body.map((value, index) => [String(index), value])
    : Object.entries(body as Record<string, unknown>);
  for (const [key, value] of entries) {
    const path = at ? `${at}.${key}` : key;
    if (typeof value === 'string') {
      const label = Object.prototype.hasOwnProperty.call(FORMULA_START_FIELDS, key) ? FORMULA_START_FIELDS[key] : undefined;
      if (label && startsLikeFormula(value)) return { field: path, label };
    } else if (value && typeof value === 'object') {
      const found = findFormulaStart(value, depth + 1, path);
      if (found) return found;
    }
  }
  return null;
}

export function formulaStartError(found: { field: string; label: string }): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: FORMULA_START_CODE,
    field: found.field,
    message: `${found.label} can't start with =, +, - or @. Remove the symbol at the start and try again.`,
  });
}

/** True for a webhook route: its @Public reason says so (route-guard-coverage keeps every reason). */
function isWebhookRoute(reflector: Reflector, context: ExecutionContext): boolean {
  const reason = reflector.getAllAndOverride<string | undefined>(PUBLIC_ROUTE_KEY, [context.getHandler(), context.getClass()]);
  return typeof reason === 'string' && /webhook/i.test(reason);
}

@Injectable()
export class FormulaTextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<Request>();
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object' && !isWebhookRoute(this.reflector, context)) {
        const found = findFormulaStart(req.body);
        if (found) throw formulaStartError(found);
      }
    }
    return next.handle();
  }
}
