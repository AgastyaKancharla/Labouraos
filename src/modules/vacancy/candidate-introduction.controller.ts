import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CandidateIntroductionService } from './candidate-introduction.service';
import { Public } from '../../common/rbac/public.decorator';

@Controller('candidate-introductions')
export class CandidateIntroductionController {
  constructor(private readonly introductions: CandidateIntroductionService) {}

  @Get(':token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async redeem(
    @Param('token') token: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { cards } = await this.introductions.redeemShareLink(token);
    if (accept?.includes('text/html')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      const html = cards.map((card) => `
        <article>
          ${card.photoUrl ? `<img src="${escapeHtml(card.photoUrl)}" alt="Candidate photo">` : ''}
          <h2>${escapeHtml(card.firstName)}, ${card.age}</h2>
          <p>${escapeHtml(card.trade)}, ${card.yearsExperience} years</p>
          <p>${card.languages.map(escapeHtml).join(', ')}</p>
          <p>${card.distanceKm} km away</p>
          <p>Expected salary: ₹${(card.expectedSalary.minPaise / 100).toLocaleString('en-IN')}–₹${(card.expectedSalary.maxPaise / 100).toLocaleString('en-IN')}</p>
          <ul>${card.matchReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
        </article>`).join('');
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Candidate profiles</title></head><body><main><h1>Candidate profiles</h1>${html}</main></body></html>`;
    }
    return { cards };
  }
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}
