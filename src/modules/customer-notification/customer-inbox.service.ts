import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerPrincipal } from '../../common/customer-auth/customer-auth.guard';
import { CustomerScopeService } from '../../common/customer-auth/customer-scope.service';
import {
  EXPO_PUSH_TOKEN_PATTERN,
  MAX_PUSH_DEVICES_PER_ACCOUNT,
  PUSH_STATUS,
  publicMessageData,
} from './customer-notification.constants';
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

function tokenInUse() {
  return notificationError(HttpStatus.CONFLICT, 'PUSH_TOKEN_IN_USE', 'This push token belongs to a phone signed in to another account');
}
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

/**
 * The signed-in customer's own inbox and own phone (docs/customer-app-api.md
 * section 9). Every query is scoped by the account id from the customer
 * token; a message id from the app only picks among the caller's own rows,
 * and any other id answers 404 exactly as if it did not exist. The inbox shows
 * account-level messages and messages about profiles that are still the
 * account's (privacy review L4); cancelled messages are never shown.
 */
@Injectable()
export class CustomerInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: CustomerNotificationClock,
    private readonly scope: CustomerScopeService,
  ) {}

  /** What the inbox may show: account-level rows, and rows about profiles still mine. */
  private async visible(accountId: string) {
    const mine = [...(await this.scope.stillMine(accountId))];
    return {
      accountId,
      pushStatus: { not: PUSH_STATUS.cancelled },
      OR: [{ profileId: null }, { profileId: { in: mine } }],
    };
  }

  async list(accountId: string, query: { cursor?: unknown; limit?: unknown }) {
    let limit = DEFAULT_LIMIT;
    if (query.limit !== undefined && query.limit !== '') {
      const parsed = Number(query.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) throw validationFailed('limit', `limit must be 1 to ${MAX_LIMIT}`);
      limit = parsed;
    }
    const after = typeof query.cursor === 'string' && query.cursor ? decodeCursor(query.cursor) : null;
    const visible = await this.visible(accountId);
    const rows = await this.prisma.customerInboxMessage.findMany({
      where: {
        ...visible,
        ...(after
          ? { AND: [{ OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }] }
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
    const unreadCount = await this.prisma.customerInboxMessage.count({ where: { ...visible, readAt: null } });
    const last = page[page.length - 1];
    return {
      items: page.map<InboxItem>((r) => ({ ...r, data: publicMessageData(r.data) })),
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
   * The phone is always the signed-in session's own (privacy review M5): a
   * body `installationId`, if sent, must be that phone's, so a token can never
   * be put on another phone row. One push token belongs to one account at a
   * time: it moves here from another account's phone only when that is this
   * same installation (someone else used this app before) or that phone has no
   * live sign-in; otherwise 409 PUSH_TOKEN_IN_USE (L2). An account keeps tokens
   * on at most 5 phones; the one seen longest ago loses its token.
   */
  async putDevice(customer: CustomerPrincipal, body: unknown): Promise<void> {
    const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const device = customer.deviceId
      ? await this.prisma.customerDevice.findFirst({
          where: { id: customer.deviceId, accountId: customer.accountId },
          select: { id: true, installationId: true },
        })
      : null;
    if (!device) {
      throw notificationError(HttpStatus.BAD_REQUEST, 'INSTALLATION_REQUIRED', 'Sign in again on this phone');
    }
    if (input.installationId !== undefined && input.installationId !== device.installationId) {
      throw validationFailed('installationId', 'installationId must be this phone\'s installation id');
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
    const save = () =>
      this.prisma.$transaction(async (tx) => {
        if (typeof pushToken === 'string') {
          const holders = await tx.customerDevice.findMany({
            where: { pushToken, NOT: { id: device.id } },
            select: { id: true, accountId: true, installationId: true },
          });
          for (const holder of holders) {
            if (holder.accountId !== customer.accountId && holder.installationId !== device.installationId) {
              const live = await tx.customerSession.count({
                where: { deviceId: holder.id, revokedAt: null, expiresAt: { gt: now } },
              });
              if (live > 0) throw tokenInUse();
            }
          }
          if (holders.length) {
            await tx.customerDevice.updateMany({ where: { id: { in: holders.map((h) => h.id) } }, data: { pushToken: null, pushTokenUpdatedAt: now } });
          }
        }
        await tx.customerDevice.update({
          where: { id: device.id },
          data: {
            platform,
            ...(appVersion !== undefined ? { appVersion: appVersion as string | null } : {}),
            ...(pushPermission !== undefined ? { pushPermission: pushPermission as string | null } : {}),
            ...tokenChange,
            revokedAt: null,
            lastSeenAt: now,
          },
        });
        if (typeof pushToken === 'string') {
          const withTokens = await tx.customerDevice.findMany({
            where: { accountId: customer.accountId, pushToken: { not: null } },
            orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
            select: { id: true },
          });
          const drop = withTokens.slice(MAX_PUSH_DEVICES_PER_ACCOUNT).map((d) => d.id).filter((id) => id !== device.id);
          if (drop.length) await tx.customerDevice.updateMany({ where: { id: { in: drop } }, data: { pushToken: null, pushTokenUpdatedAt: now } });
        }
      });
    try {
      await save();
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      // Another request saved the same token at the same moment: read again, never a 500.
      const holder = await this.prisma.customerDevice.findFirst({ where: { pushToken: pushToken as string }, select: { id: true } });
      if (holder?.id === device.id) return;
      try {
        await save(); // once more, with the other holder now visible to the rules above
      } catch (again) {
        if ((again as { code?: string })?.code === 'P2002') throw tokenInUse();
        throw again;
      }
    }
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
