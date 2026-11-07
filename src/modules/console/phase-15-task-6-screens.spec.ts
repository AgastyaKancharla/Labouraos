import { InterviewController } from '../vacancy/interview.controller';
import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';

describe('Phase 15 Task 6 screens', () => {
  it('renders interview booking, interview lists, answered-call replies, and payment status for call agents', () => {
    const html = renderCallAgentConsoleHtml();
    expect(html).toContain('Book interview');
    expect(html).toContain('/interviews/vacancies/');
    expect(html).toContain('My Interviews');
    expect(html).toContain('Reply due');
    expect(html).toContain('Result due');
    expect(html).toContain('Attendance visit');
    expect(html).toContain('if (interview.answeredOfferCallId)');
    expect(html).toContain('Placement Payment Status');
    expect(html).toContain("paymentStatus = placement.paidAt ? 'Paid'");
    expect(html).not.toContain("'/respond'");
    expect(html).not.toMatch(/(?:\+91)?[6-9]\d{9}/);
  });

  it('renders interview booking and per-agent/per-vacancy interview status for field agents', () => {
    const html = renderFieldAgentAppHtml();
    expect(html).toContain('Book interview');
    expect(html).toContain('My Interviews');
    expect(html).toContain('Filter by vacancy ID or code');
    expect(html).toContain('if (interview.answeredOfferCallId)');
    expect(html).not.toContain('/vacancies/\' + vcId + '/placements');
    expect(html).not.toMatch(/(?:\+91)?[6-9]\d{9}/);
  });

  it('renders Team Lead interview oversight and placement payment deadlines', () => {
    const html = renderAdminDashboardHtml();
    expect(html).toContain('Interview Oversight');
    expect(html).toContain('OVERDUE RESULT');
    expect(html).toContain('RESULT MISMATCH');
    expect(html).toContain('NO RESULT');
    expect(html).toContain('Payment due');
    expect(html).toContain('Awaiting payment');
    expect(html).toContain('Overdue');
    expect(html).toContain("['team_lead', 'manager', 'ceo'].includes(payload.role)");
  });

  it('keeps business name and address off the candidate offer view before confirmation', async () => {
    const controller = new InterviewController({
      validateCandidateReplyLink: jest.fn(),
    } as never);
    const html = await controller.replyPage('single-use-token');
    expect(html).toContain('Can you attend this interview?');
    expect(html).not.toContain('businessName');
    expect(html).not.toContain('address');
  });
});
