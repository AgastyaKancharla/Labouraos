import { BadRequestException, Controller, Get, Header, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Public } from '../../common/rbac/public.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { isLegalDocumentKey } from './legal-documents';
import { isLegalLanguage, LegalLanguage } from './legal-document.types';
import { LegalDocumentService, LegalSubjectType } from './legal-document.service';

function languageOf(value: string | undefined): LegalLanguage {
  return isLegalLanguage(value) ? value : 'en';
}

const SUBJECTS: readonly LegalSubjectType[] = ['job_seeker', 'business', 'referral'];

/**
 * The legal documents (Master Guide rev 176). The texts and the company /
 * Grievance Officer block are public (every public page shows them); who
 * accepted which version is staff-only.
 */
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalDocumentService) {}

  @Get('company')
  @Public('public company details and Grievance Officer for every public page footer; no personal data')
  company(@Query('lang') lang?: string) {
    return this.legal.publicCompany(languageOf(lang));
  }

  @Get('documents/:key')
  @Public('public legal document text (In short + full text) in kn/hi/en; no personal data')
  document(@Param('key') key: string, @Query('lang') lang?: string) {
    if (!isLegalDocumentKey(key)) throw new NotFoundException('No such legal document');
    return this.legal.publicDocument(key, languageOf(lang));
  }

  /** Which version each person accepted (C-JobSeeker, C-Business, C-Partner). Laboura Field reads it on the scoped status screen. */
  @Get('acceptances/:subjectType/:subjectId')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('manager', 'ceo', 'finance')
  async acceptances(@Param('subjectType') subjectType: string, @Param('subjectId') subjectId: string) {
    if (!(SUBJECTS as readonly string[]).includes(subjectType)) throw new BadRequestException('subjectType must be job_seeker, business or referral');
    const type = subjectType as LegalSubjectType;
    const [status, acceptances] = await Promise.all([this.legal.status(type, subjectId), this.legal.acceptances(type, subjectId)]);
    return { status, acceptances };
  }

  /** The exact text someone accepted (the signed copy): "View signed copy" on the staff screens. */
  @Get('acceptance-text/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('manager', 'ceo')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  async text(@Param('id') id: string) {
    const html = await this.legal.acceptanceText(id);
    if (!html) throw new NotFoundException('No such acceptance');
    return html;
  }
}
