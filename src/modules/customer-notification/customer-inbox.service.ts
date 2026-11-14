import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerPrincipal } from '../../common/customer-auth/customer-auth.guard';
import { EXPO_PUSH_TOKEN_PATTERN } from './customer-notification.constants';
import { CustomerNotificationClock } from './customer-notification.clock';
import { notificationError, validationFailed } from './customer-notification.errors';

export interface InboxItem {
  id: string;
  profileId: string | null;
  kind: string;
  category: string;
  priority: string;
  title: string;
  body: string;
  deepLink: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const PLATFORMS = ['android', 'ios', 'web'] as const;
const PERMISSIONS = ['granted', 'denied', 'undetermined'] as const;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw validationFailed('cursor', 'cursor is not valid');
  return { createdAt, id };
}

/** Internal keys the server keeps in `data`; the app never needs them. */
function publicData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const rest = { ...(data as Record<string, unknown>) };
  delete rest.trigger;
  return rest;
}

/**
 * The signed-in customer's own inbox and own phone (docs/customer-app-api.md
 * section 9). Every query is scoped by the account id from the customer
 * token; a message id from the app only picks among the caller's own rows,
 * and any other id answers 404 exactly as if it did not exist.
 */
@Injectable()
export class CustomerInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerNotificationClock,
  ) {}

  async list(accountId: string, query: { cursor?: unknown; limit?: unknown }) {
    let limit = DEFAULT_LIMIT;
    if (query.limit !== undefined && query.limit !== '') {
      const parsed = Number(query.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) throw validationFailed('limit', `limit must be 1 to ${MAX_LIMIT}`);
      limit = parsed;
    }
    const after = typeof query.cursor === 'string' && query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.prisma.customerInboxMessage.findMany({
      where: {
        accountId,
        ...(after
          ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, profileId: true, kind: true, category: true, priority: true, title: true, body: true,
        deepLink: true, data: true, createdAt: true, readAt: true,
      },
    });
    const page = rows.slice(0, limit);
    const unreadCount = await this.prisma.customerInboxMessage.count({ where: { accountId, readAt: null } });
    const last = page[page.length - 1];
    return {
      items: page.map<InboxItem>((r) => ({ ...r, data: publicData(r.data) })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
      unreadCount,
    };
  }

  async markRead(accountId: string, messageId: string): Promise<void> {
    const row = await this.prisma.customerInboxMessage.findFirst({ where: { id: messageId, accountId }, select: { id: true, readAt: true } });
    if (!row) throw notificationError(HttpStatus.NOT_FOUND, 'MESSAGE_NOT_FOUND', 'Message not found');
    if (!row.readAt) {
      await this.prisma.customerInboxMessage.updateMany({ where: { id: row.id, accountId, readAt: null }, data: { readAt: this.clock.now() } });
    }
  }

  async markAllRead(accountId: string): Promise<void> {
    await this.prisma.customerInboxMessage.updateMany({ where: { accountId, readAt: null }, data: { readAt: this.clock.now() } });
  }

  /**
   * PUT /me/device: this phone's app version, permission and push token.
   * One push token belongs to one account at a time: saving it here removes
   * it from any other phone row (another account that used this phone before).
   */
  async putDevice(customer: CustomerPrincipal, body: unknown): Promise<void> {
    const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const installationId = input.installationId;
    if (typeof installationId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(installationId)) {
      throw validationFailed('installationId', 'installationId must be the app installation id');
    }
    const platform = input.platform;
    if (typeof platform !== 'string' || !(PLATFORMS as readonly string[]).includes(platform)) {
      throw validationFailed('platform', 'platform must be android, ios or web');
    }
    const appVersion = input.appVersion;
    if (appVersion !== undefined && appVersion !== null && (typeof appVersion !== 'string' || appVersion.length > 40)) {
      throw validationFailed('appVersion', 'appVersion must be a short text');
    }
    const pushPermission = input.pushPermission;
    if (pushPermission !== undefined && pushPermission !== null && !(PERMISSIONS as readonly unknown[]).includes(pushPermission)) {
      throw validationFailed('pushPermission', 'pushPermission must be granted, denied or undetermined');
    }
    const pushToken = input.pushToken;
    if (pushToken !== undefined && pushToken !== null && (typeof pushToken !== 'string' || !EXPO_PUSH_TOKEN_PATTERN.test(pushToken))) {
      throw validationFailed('pushToken', 'pushToken must be an Expo push token');
    }
    const now = this.clock.now();
    const tokenChange = pushToken === undefined ? {} : { pushToken: pushToken as string | null, pushTokenUpdatedAt: now };
    await this.prisma.$transaction(async (tx) => {
      if (typeof pushToken === 'string') {
        await tx.customerDevice.updateMany({
          where: { pushToken, NOT: { accountId: customer.accountId, installationId } },
          data: { pushToken: null, pushTokenUpdatedAt: now },
        });
      }
      await tx.customerDevice.upsert({
        where: { accountId_installationId: { accountId: customer.accountId, installationId } },
        create: {
          accountId: customer.accountId,
          installationId,
          platform,
          appVersion: (appVersion as string | null | undefined) ?? null,
          pushPermission: (pushPermission as string | null | undefined) ?? null,
          ...tokenChange,
          lastSeenAt: now,
        },
        update: {
          platform,
          ...(appVersion !== undefined ? { appVersion: appVersion as string | null } : {}),
          ...(pushPermission !== undefined ? { pushPermission: pushPermission as string | null } : {}),
          ...tokenChange,
          revokedAt: null,
          lastSeenAt: now,
        },
      });
    });
  }

  /**
   * DELETE /me/device/push-token: no more pushes to this phone. The phone is
   * the session's device, or the X-Laboura-Installation header's installation.
   */
  async removePushToken(customer: CustomerPrincipal, installationId: string | undefined): Promise<void> {
    const now = this.clock.now();
    if (customer.deviceId) {
      await this.prisma.customerDevice.updateMany({
        where: { id: customer.deviceId, accountId: customer.accountId },
        data: { pushToken: null, pushTokenUpdatedAt: now },
      });
    }
    if (installationId) {
      await this.prisma.customerDevice.updateMany({
        where: { accountId: customer.accountId, installationId },
        data: { pushToken: null, pushTokenUpdatedAt: now },
      });
    }
  }
}
