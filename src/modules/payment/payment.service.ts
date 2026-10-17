import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
