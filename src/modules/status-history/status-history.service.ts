import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';

/** Who is asking: a Team Lead or Manager sees only trails inside their own tree. */
export interface StatusHistoryViewer {
  id: string;
  role: string;
}

@Injectable()
export class StatusHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly reportingScope?: ReportingScopeService,
  ) {}

  async getHistory(subjectType?: string, subjectId?: string, viewer?: StatusHistoryViewer) {
    if (!subjectType || !subjectId) {
      throw new BadRequestException(
        'subjectType and subjectId are required query parameters',
      );
    }

    const rows = await this.prisma.statusHistory.findMany({
      where: {
        subjectType,
        subjectId,
      },
      orderBy: {
        changedAt: 'asc',
      },
      include: {
        changedByStaff: {
          select: {
            id: true,
            code: true,
            name: true,
            role: true,
          },
        },
      },
    });

    // Security check L7, the audit log's scope: a Team Lead or Manager reads a trail
    // only when it is about someone in their tree, or someone in their tree changed it
    // (themselves included). Anything else answers as if there were no history.
    if (viewer && (viewer.role === 'team_lead' || viewer.role === 'manager') && this.reportingScope) {
      const ids = new Set([viewer.id, ...(await this.reportingScope.peopleUnder(viewer.id))]);
      const aboutTheirPerson = subjectType === 'staff' && ids.has(subjectId);
      const changedByTheirPerson = rows.some((row) => row.changedByStaffId && ids.has(row.changedByStaffId));
      if (!aboutTheirPerson && !changedByTheirPerson) return [];
    }
    return rows;
  }
}
