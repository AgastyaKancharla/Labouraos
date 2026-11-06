import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';

describe('Phase 14 Task 5 screens', () => {
  it('renders paged, selectable candidate cards and introduction actions for call agents', () => {
    const html = renderCallAgentConsoleHtml();
    expect(html).toContain('/shortlist?page=');
    expect(html).toContain('Show next 3');
    expect(html).toContain('shortlist-left-out');
    expect(html).toContain('sendSelectedToOwner');
    expect(html).toContain('showSelectedInPerson');
    const cardRenderer = html.slice(html.indexOf('async function loadShortlistPage'), html.indexOf('async function submitSelectedIntroductions'));
    expect(cardRenderer).not.toMatch(/\.phone\b|\.address\b|\.latitude\b|\.longitude\b|dateOfBirth|\bdob\b/i);
  });

  it('renders the same paged and privacy-safe candidate card flow for field agents', () => {
    const html = renderFieldAgentAppHtml();
    expect(html).toContain('/shortlist?page=');
    expect(html).toContain('Show next 3');
    expect(html).toContain('Left out — no location:');
    expect(html).toContain('showFieldSelectedInPerson');
    expect(html).toContain('sendFieldSelectedToOwner');
    const cardRenderer = html.slice(html.indexOf('async function loadFieldShortlistPage'), html.indexOf('async function submitFieldIntroductions'));
    expect(cardRenderer).not.toMatch(/\.phone\b|\.address\b|\.latitude\b|\.longitude\b|dateOfBirth|\bdob\b/i);
  });

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
