import type { SidebarConfig } from './types';

/* Sidebars copied from the approved designs: CEO = Main.dc.html, Manager = MG-Home,
   Team Lead = T-Home, Finance = FN-Home. Order, sections, icons and badge colours match. */

export const ceoSidebar: SidebarConfig = {
  subtitle: "subtitle.ceo",
  sections: [
    {
      label: 'navSection.overview',
      items: [
        { screen: 'Main', label: 'nav.commandCenter', icon: 'commandCenter' },
        { screen: 'C-Reports', label: 'nav.reports', icon: 'reports' },
      ],
    },
    {
      label: 'navSection.pipeline',
      items: [
        { screen: 'JobSeekers', label: 'nav.jobSeekers', icon: 'jobSeekers' },
        { screen: 'C-Referrals', label: 'nav.referrals', icon: 'referrals' },
        { screen: 'C-Businesses', label: 'nav.businesses', icon: 'businesses' },
        { screen: 'C-Vacancies', label: 'nav.vacancies', icon: 'vacancies' },
        { screen: 'C-Interviews', label: 'nav.interviews', icon: 'interviews', badge: { tone: 'cyan', source: 'interviews-today' } },
        { screen: 'C-Placements', label: 'nav.placements', icon: 'placements' },
      ],
    },
    {
      label: 'navSection.money',
      items: [
        { screen: 'C-Payments', label: 'nav.payments', icon: 'payments' },
        { screen: 'C-Refunds', label: 'nav.refundApprovals', icon: 'refundApprovals', badge: { tone: 'tomato', source: 'refunds-due' } },
        { screen: 'C-Expenses', label: 'nav.expenses', icon: 'expenses' },
        { screen: 'FN-Review', label: 'nav.monthEndReview', icon: 'monthEndReview' },
        { screen: 'C-Pricing', label: 'nav.pricingAndPolicy', icon: 'pricingAndPolicy' },
      ],
    },
    {
      label: 'navSection.operations',
      items: [
        { screen: 'C-CallCenter', label: 'nav.callCenter', icon: 'callCenter', badge: { tone: 'gold', source: 'callbacks-waiting' } },
        { screen: 'C-FieldOps', label: 'nav.fieldOps', icon: 'fieldOps' },
        { screen: 'C-Team-Attendance', label: 'nav.attendance', icon: 'attendance' },
        { screen: 'C-Team-Targets', label: 'nav.targets', icon: 'targets' },
      ],
    },
    {
      label: 'navSection.admin',
      items: [
        { screen: 'C-Team', label: 'nav.teamAndAccess', icon: 'teamAndAccess' },
        { screen: 'C-LoginCodes', label: 'nav.loginCodes', icon: 'loginCodes', badge: { tone: 'gold', source: 'login-codes' } },
        { screen: 'C-Audit-Flags', label: 'nav.flags', icon: 'flags', badge: { tone: 'tomato', source: 'review-flags' } },
        { screen: 'C-Privacy', label: 'nav.consentAndPrivacy', icon: 'consentAndPrivacy' },
        { screen: 'C-System', label: 'nav.systemHealth', icon: 'systemHealth' },
        { screen: 'C-Audit', label: 'nav.auditLog', icon: 'auditLog' },
      ],
    },
  ],
};

export const managerSidebar: SidebarConfig = {
  subtitle: "subtitle.manager",
  sections: [
    {
      label: 'navSection.overview',
      items: [
        { screen: 'MG-Home', label: 'nav.commandCenter', icon: 'commandCenter' },
        { screen: 'MG-Plan', label: 'nav.planVsActual', icon: 'planVsActual' },
        { screen: 'MG-Reports', label: 'nav.reports', icon: 'reports' },
      ],
    },
    {
      label: 'navSection.requests',
      items: [
        { screen: 'MG-Requests', label: 'nav.requests', icon: 'requests', badge: { tone: 'tomato', source: 'requests-open' } },
        { screen: 'MG-Leave', label: 'nav.leave', icon: 'leave' },
      ],
    },
    {
      label: 'navSection.people',
      items: [
        { screen: 'MG-Teams', label: 'nav.teams', icon: 'teamAndAccess' },
        { screen: 'MG-Agents', label: 'nav.agents', icon: 'jobSeekers' },
        { screen: 'MG-Attendance', label: 'nav.attendance', icon: 'attendance' },
        { screen: 'MG-Targets', label: 'nav.targets', icon: 'targets' },
      ],
    },
    {
      label: 'navSection.work',
      items: [
        { screen: 'MG-Pipeline', label: 'nav.pipeline', icon: 'pipeline' },
        { screen: 'MG-CallCenter', label: 'nav.callCenter', icon: 'callCenter', badge: { tone: 'gold', source: 'callbacks-waiting' } },
        { screen: 'MG-FieldOps', label: 'nav.fieldOps', icon: 'fieldOps' },
      ],
    },
    {
      label: 'navSection.admin',
      items: [
        { screen: 'MG-Flags', label: 'nav.flags', icon: 'flags', badge: { tone: 'tomato', source: 'review-flags' } },
        { screen: 'MG-LoginCodes', label: 'nav.loginCodes', icon: 'loginCodes', badge: { tone: 'gold', source: 'login-codes' } },
        { screen: 'MG-Staff', label: 'nav.staffAndAccess', icon: 'teamAndAccess' },
      ],
    },
  ],
};

export const teamLeadSidebar: SidebarConfig = {
  subtitle: "subtitle.teamLead",
  sections: [
    {
      label: 'navSection.overview',
      items: [
        { screen: 'T-Home', label: 'nav.myTeam', icon: 'teamAndAccess' },
        { screen: 'T-Targets', label: 'nav.targets', icon: 'targets' },
        { screen: 'T-Reports', label: 'nav.reports', icon: 'reports' },
      ],
    },
    {
      label: 'navSection.requests',
      items: [
        { screen: 'T-Requests', label: 'nav.requests', icon: 'requests', badge: { tone: 'tomato', source: 'requests-open' } },
        { screen: 'T-Leave', label: 'nav.leave', icon: 'leave' },
      ],
    },
    {
      label: 'navSection.people',
      items: [
        { screen: 'T-Agents', label: 'nav.agents', icon: 'jobSeekers' },
        { screen: 'T-Attendance', label: 'nav.attendance', icon: 'attendance' },
      ],
    },
    {
      label: 'navSection.quality',
      items: [
        { screen: 'T-Quality', label: 'nav.listenToCalls', icon: 'listenToCalls', badge: { tone: 'gold', source: 'calls-to-review' } },
        { screen: 'T-Verify', label: 'nav.checkRegistrations', icon: 'checkRegistrations', badge: { tone: 'gold', source: 'registrations-to-check' } },
        { screen: 'T-Visits', label: 'nav.visitProof', icon: 'fieldOps', badge: { tone: 'tomato', source: 'visit-proof-to-check' } },
      ],
    },
    {
      label: 'navSection.work',
      items: [
        { screen: 'T-Work', label: 'nav.workList', icon: 'workList' },
        { screen: 'T-LoginCodes', label: 'nav.loginCodes', icon: 'loginCodes', badge: { tone: 'gold', source: 'login-codes' } },
        { screen: 'T-Flags', label: 'nav.flags', icon: 'flags', badge: { tone: 'tomato', source: 'review-flags' } },
      ],
    },
  ],
};

export const financeSidebar: SidebarConfig = {
  subtitle: "subtitle.finance",
  sections: [
    {
      label: 'navSection.overview',
      items: [
        { screen: 'FN-Home', label: 'nav.moneyToday', icon: 'moneyToday' },
        { screen: 'FN-Reports', label: 'nav.reports', icon: 'reports' },
      ],
    },
    {
      label: 'navSection.moneyIn',
      items: [
        { screen: 'FN-MoneyIn', label: 'nav.moneyIn', icon: 'moneyIn', badge: { tone: 'gold', source: 'bank-credits-unmatched' } },
        { screen: 'FN-Invoices', label: 'nav.invoices', icon: 'invoices', badge: { tone: 'tomato', source: 'invoices-unpaid' } },
      ],
    },
    {
      label: 'navSection.moneyOut',
      items: [
        { screen: 'FN-Refunds', label: 'nav.refunds', icon: 'refunds', badge: { tone: 'tomato', source: 'refunds-due' } },
        { screen: 'FN-Payouts', label: 'nav.payouts', icon: 'payouts', badge: { tone: 'gold', source: 'payouts-due' } },
        { screen: 'FN-Expenses', label: 'nav.expensesAndBills', icon: 'expenses', badge: { tone: 'gold', source: 'expenses-to-approve' } },
        { screen: 'FN-Salaries', label: 'nav.salaries', icon: 'salaries' },
      ],
    },
    {
      label: 'navSection.control',
      items: [
        { screen: 'FN-Bank', label: 'nav.bank', icon: 'bank', badge: { tone: 'gold', source: 'bank-credits-unmatched' } },
        { screen: 'FN-Tax', label: 'nav.tax', icon: 'tax' },
        { screen: 'FN-Limits', label: 'nav.approvalLimits', icon: 'approvalLimits' },
        { screen: 'FN-Review', label: 'nav.monthEndReview', icon: 'monthEndReview' },
      ],
    },
  ],
};

