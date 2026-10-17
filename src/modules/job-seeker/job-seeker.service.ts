import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class JobSeekerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.jobSeeker.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
