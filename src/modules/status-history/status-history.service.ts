import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class StatusHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(subjectType?: string, subjectId?: string) {
    if (!subjectType || !subjectId) {
      throw new BadRequestException(
        'subjectType and subjectId are required query parameters',
      );
    }

    return this.prisma.statusHistory.findMany({
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
  }
}
