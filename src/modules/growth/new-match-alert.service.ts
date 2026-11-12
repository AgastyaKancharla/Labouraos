import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MatchingService } from '../vacancy/matching.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';

/** How far back a newly activated job seeker is looked at (each pair is alerted once, so overlap is safe). */
export const NEW_MATCH_LOOKBACK_MS = 24 * 3600 * 1000;

/**
 * Guide, "What happens when things don't go to plan": a vacancy with no more
 * matching candidates stays open, and the field agent is alerted when a new
 * match registers. When a job seeker becomes active (registration paid) and
 * passes the matching engine's rules for an open vacancy, the business's
 * account agent (a field agent) gets one bell for that pair: the vacancy and
 * the job seeker's code and first name, never a phone number or money.
 * Swept with the bells (every few minutes); each pair rings once.
 */
@Injectable()
export class NewMatchAlertService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationService,
    private readonly sources: NotificationSourcesService,
  ) {}

  onModuleInit(): void {
    this.sources.registerRequestSource('new match alerts', (now) => this.sweep(now));
  }

  async sweep(now: Date = new Date()): Promise<{ alerted: number }> {
    const since = new Date(now.getTime() - NEW_MATCH_LOOKBACK_MS);
    const fresh = await this.prisma.jobSeeker.count({ where: { status: 'active', paymentReceivedAt: { gte: since, lte: now } } });
    if (!fresh) return { alerted: 0 };
    const agents = await this.prisma.staff.findMany({ where: { role: 'field_agent', status: 'active' }, select: { id: true } });
    if (!agents.length) return { alerted: 0 };
    const vacancies = await this.prisma.vacancy.findMany({
      where: { status: 'open', business: { accountAgentId: { in: agents.map((a) => a.id) } } },
      select: { id: true, code: true, tradeSkill: true, business: { select: { id: true, name: true, accountAgentId: true } } },
      take: 2000,
    });
    if (!vacancies.length) return { alerted: 0 };
    const suitable = await this.matching.suitableSeekerIds(
      vacancies.map((v) => v.id),
      { status: 'active', paymentReceivedAt: { gte: since, lte: now } },
    );
    const seekerIds = [...new Set([...suitable.values()].flatMap((ids) => ids ?? []))];
    if (!seekerIds.length) return { alerted: 0 };
    const seekers = new Map(
      (await this.prisma.jobSeeker.findMany({ where: { id: { in: seekerIds } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]),
    );
    let alerted = 0;
    for (const vacancy of vacancies) {
      const agentId = vacancy.business.accountAgentId;
      if (!agentId) continue;
      for (const seekerId of suitable.get(vacancy.id) ?? []) {
        const seeker = seekers.get(seekerId);
        if (!seeker) continue;
        const first = seeker.name.trim().split(/\s+/)[0] ?? '';
        const opened = await this.notifications.open(
          {
            recipientStaffId: agentId,
            kind: 'new_match_registered',
            title: `New match for ${vacancy.code} (${vacancy.tradeSkill}) at ${vacancy.business.name}`,
            body: `${seeker.code} ${first} just registered and fits this vacancy · show them to the owner`,
            link: null,
            subjectType: 'vacancy_new_match',
            subjectId: `${vacancy.id}:${seeker.id}`,
            once: true,
          },
          now,
        );
        if (opened) alerted += 1;
      }
    }
    return { alerted };
  }
}
