import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isValidReceiptToken } from './receipt-link';

/**
 * Opens GET /payments/:id/receipt for the payer holding the signed link token,
 * or for a logged-in staff member whose role the route allows. Anyone else
 * is refused: a payment id on its own opens nothing.
 */
@Injectable()
export class PaymentReceiptGuard implements CanActivate {
  private readonly jwtGuard: JwtAuthGuard;
  private readonly rbacGuard: RbacGuard;

  constructor(reflector: Reflector, prisma: PrismaService) {
    this.jwtGuard = new JwtAuthGuard(reflector);
    this.rbacGuard = new RbacGuard(reflector, prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const paymentId = String(request.params?.id ?? '');
    if (isValidReceiptToken(paymentId, request.query?.token)) {
      return true;
    }
    const authenticated = await this.jwtGuard.canActivate(context);
    if (!authenticated) {
      return false;
    }
    return this.rbacGuard.canActivate(context);
  }
}
