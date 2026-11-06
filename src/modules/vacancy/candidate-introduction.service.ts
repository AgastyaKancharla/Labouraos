import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentClock } from '../consent/consent-clock';
import { MessagingService } from '../message/messaging.service';
import { MatchingService } from './matching.service';

type CurrentMatch = {
  jobSeekerId: string;
  score: number;
  matchReasons: string[];
  card: {
    firstName: string;
    photoUrl: string | null;
    photoUrlExpiresInSeconds: number | null;
    age: number;
    trade: string;
    yearsExperience: number;
    languages: string[];
    distanceKm: number;
    expectedSalary: { minPaise: number; maxPaise: number };
    matchReasons: string[];
  };
};

@Injectable()
export class CandidateIntroductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matchingService: MatchingService,
    private readonly messagingService: MessagingService,
    private readonly clock: ConsentClock,
  ) {}

  async shareByLink(vacancyId: string, jobSeekerIds: string[], staffId: string, channel: 'sms' | 'whatsapp' = 'sms') {
    if (channel !== 'sms' && channel !== 'whatsapp') throw new BadRequestException('channel must be sms or whatsapp');
    const { vacancy, matches } = await this.currentlyEligible(vacancyId, jobSeekerIds);
    const ranked = this.rankMatches(matches);
    const selected = jobSeekerIds.map((jobSeekerId) => {
      const found = ranked.get(jobSeekerId);
      if (!found) throw new BadRequestException(`Candidate ${jobSeekerId} does not pass current matching rules`);
      return { jobSeekerId, ...found };
    });
    const token = randomBytes(32).toString('hex');
    const link = `${process.env.APP_BASE_URL ?? ''}/candidate-introductions/${token}`;
    await this.prisma.candidateIntroductionLink.create({
      data: {
        tokenHash: this.hashToken(token),
        businessId: vacancy.businessId,
        vacancyId: vacancy.id,
        jobSeekerIds,
      },
    });
    const message = await this.messagingService.send({
      channel,
      template: 'candidates_shared',
      subjectType: 'business',
      subjectId: vacancy.businessId,
      relatedType: 'vacancy',
      relatedId: vacancy.id,
      variables: { link },
    });
    if (message.status === 'failed') {
      await this.prisma.candidateIntroductionLink.delete({ where: { tokenHash: this.hashToken(token) } });
      throw new ServiceUnavailableException('The candidate link could not be sent');
    }
    const shownAt = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.candidateIntroduction.createMany({
        data: selected.map(({ jobSeekerId, match, rank }) => ({
          businessId: vacancy.businessId,
          vacancyId: vacancy.id,
          jobSeekerId,
          shownByStaffId: staffId,
          shownAt,
          rank,
          score: match.score,
          matchReasons: match.matchReasons as unknown as Prisma.InputJsonValue,
          channel: 'share_link',
          messageLogId: message.id,
        })),
      });
    });
    return { count: selected.length, channel: 'share_link' as const, messageLogId: message.id };
  }

  async redeemShareLink(token: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('Share link is invalid or already used');
    const tokenHash = this.hashToken(token);
    const link = await this.prisma.candidateIntroductionLink.findUnique({ where: { tokenHash } });
    if (!link) throw new UnauthorizedException('Share link is invalid or already used');
    const redeemed = await this.prisma.candidateIntroductionLink.updateMany({
      where: { id: link.id, consumedAt: null },
      data: { consumedAt: this.clock.now() },
    });
    if (redeemed.count !== 1) throw new UnauthorizedException('Share link is invalid or already used');

    const { matches } = await this.currentlyEligible(link.vacancyId, link.jobSeekerIds);
    const byId = new Map(matches.map((match) => [match.jobSeekerId, match]));
    const cards = link.jobSeekerIds.flatMap((jobSeekerId) => {
      const match = byId.get(jobSeekerId);
      return match ? [match.card] : [];
    });
    return { cards };
  }

  async showInPerson(vacancyId: string, jobSeekerIds: string[], staffId: string) {
    const { vacancy, matches } = await this.currentlyEligible(vacancyId, jobSeekerIds);
    const ranked = this.rankMatches(matches);
    const shownAt = this.clock.now();
    const rows = jobSeekerIds.map((jobSeekerId) => {
      const found = ranked.get(jobSeekerId);
      if (!found) throw new BadRequestException(`Candidate ${jobSeekerId} does not pass current matching rules`);
      return {
        businessId: vacancy.businessId,
        vacancyId: vacancy.id,
        jobSeekerId,
        shownByStaffId: staffId,
        shownAt,
        rank: found.rank,
        score: found.match.score,
        matchReasons: found.match.matchReasons as unknown as Prisma.InputJsonValue,
        channel: 'in_person',
        messageLogId: null,
      };
    });

    await this.prisma.candidateIntroduction.createMany({ data: rows });
    return { count: rows.length, channel: 'in_person' as const };
  }

  async firstIntroduction(businessId: string, jobSeekerId: string): Promise<Date | null> {
    const row = await this.prisma.candidateIntroduction.findFirst({
      where: { businessId, jobSeekerId },
      orderBy: [{ shownAt: 'asc' }, { id: 'asc' }],
      select: { shownAt: true },
    });
    return row?.shownAt ?? null;
  }

  private async currentlyEligible(vacancyId: string, jobSeekerIds: string[]) {
    if (!Array.isArray(jobSeekerIds) || jobSeekerIds.length === 0 || jobSeekerIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new BadRequestException('jobSeekerIds must be a non-empty array of ids');
    }
    if (new Set(jobSeekerIds).size !== jobSeekerIds.length) {
      throw new BadRequestException('jobSeekerIds must not contain duplicates');
    }

    const vacancy = await this.prisma.vacancy.findFirst({
      where: vacancyId.startsWith('VC-') ? { code: vacancyId } : { id: vacancyId },
      select: { id: true, businessId: true },
    });
    if (!vacancy) throw new NotFoundException(`Vacancy '${vacancyId}' not found`);

    const firstPage = await this.matchingService.match(vacancy.id, { page: 1 });
    const matches: CurrentMatch[] = [...firstPage.matches];
    const pageCount = Math.ceil(firstPage.total / firstPage.pageSize);
    for (let page = 2; page <= pageCount; page += 1) {
      const result = await this.matchingService.match(vacancy.id, { page });
      matches.push(...result.matches);
    }
    return { vacancy, matches };
  }

  private rankMatches(matches: CurrentMatch[]) {
    return new Map(matches.map((match, index) => [match.jobSeekerId, { match, rank: index + 1 }]));
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
