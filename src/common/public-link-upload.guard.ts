import { applyDecorators, BadRequestException, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PublicLinkStoreService } from './public-link-store.service';

const LINK_KIND_KEY = 'public_link_upload_kind';

interface LinkKind {
  purpose: string;
  subjectType: string;
  message: string;
  /** 25 Nov (B9): a used (signed) agreement link still takes the small-business photos. */
  allowUsed?: boolean;
}

/**
 * M4: on a public page that takes a photo, the link token in the address is
 * checked BEFORE the file is read. Guards run before interceptors, so a wrong
 * or dead token is refused without the 5 MB upload ever being buffered in
 * memory. The handler still does its full checks (OTP, consent) afterwards.
 */
@Injectable()
export class PublicLinkUploadGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly links: PublicLinkStoreService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.get<LinkKind | undefined>(LINK_KIND_KEY, context.getHandler());
    if (!kind) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const token = (request.params as Record<string, string | undefined>)?.token;
    if (!token) throw new BadRequestException(kind.message);
    const link = kind.allowUsed ? await this.links.findByTokenAllowingUsed(token) : await this.links.findByToken(token);
    if (link.purpose !== kind.purpose || link.subjectType !== kind.subjectType || !link.phone) {
      throw new BadRequestException(kind.message);
    }
    return true;
  }
}

/** Checks the `:token` link (purpose and subject) before any upload is read. */
export function CheckLinkBeforeUpload(purpose: string, subjectType: string, message: string, options: { allowUsed?: boolean } = {}) {
  return applyDecorators(SetMetadata(LINK_KIND_KEY, { purpose, subjectType, message, allowUsed: options.allowUsed === true }), UseGuards(PublicLinkUploadGuard));
}
