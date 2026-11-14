import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';

describe('Phase 14 Task 5 screens', () => {
  it('renders the business introduction history for Team Leads and management only', () => {
    const html = renderAdminDashboardHtml();
    expect(html).toContain('business-introduction-panel');
    expect(html).toContain("['team_lead', 'manager', 'ceo'].includes(currentUser?.role)");
    expect(html).toContain('/introductions');
    expect(html).toContain('shownByName');
    expect(html).toContain('candidateFirstName');
    expect(html).not.toMatch(/candidateFirstName[^\n]{0,200}(?:\.phone|\.address|\.latitude|\.longitude|dateOfBirth|\bdob\b)/i);
  });
});
