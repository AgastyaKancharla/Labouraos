/**
 * Routes with a path parameter that Team Leads or agents can reach, whose
 * scope is applied by the service (or by a guard of their own) rather than by
 * a RbacGuard permission target. Each entry says why it is safe and names the
 * spec (path from src/) that proves it, plus a line of that spec (`proof`)
 * that must still be there. route-guard-coverage.spec.ts fails for any such
 * route missing here, for any entry whose route is gone, and for any proof
 * that disappeared from its spec.
 */
export interface ServiceScopedRoute {
  reason: string;
  test: string;
  proof: string;
}

export const SERVICE_SCOPED_ROUTES: Record<string, ServiceScopedRoute> = {
  // ---------------------------------------------------------------- audit, notifications
  'AuditController.getAuditLogById': {
    reason: 'A Team Lead reads only rows about their own team (OwnTeam); anything else is 404.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: "a Team Lead cannot open another team's audit row",
  },
  'NotificationController.seenOne': {
    reason: "Only the recipient's own notification; anyone else's is 404.",
    test: 'modules/notification/phase-21-task-6-notifications.spec.ts',
    proof: '/notifications/${mine!.id}/seen`)).status).toBe(404)',
  },

  // ---------------------------------------------------------------- attendance
  'AttendanceController.approve': {
    reason: "Only the person's own Team Lead (reportsTo/teamLeadId), their Manager or the CEO; never one's own.",
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: "another team's Team Lead cannot approve a system problem",
  },
  'AttendanceController.changeDay': {
    reason: "Only the person's Team Lead, their Manager or the CEO; never one's own day.",
    test: 'modules/attendance/phase-21-task-3-day-rules.spec.ts',
    proof: "changeDay(leadB, day.id, { dayType: 'full', reason: 'other team' })).status).toBe(403)",
  },
  'AttendanceController.dayHistory': {
    reason: 'The person themselves or someone above them in the reporting line (canSee).',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: "another team's Team Lead cannot read a day's history",
  },
  'AttendanceRequestsController.approve': {
    reason: "Decided only by the person's Team Lead or Manager in their line; never one's own.",
    test: 'modules/attendance/phase-21-task-4-leave-corrections.spec.ts',
    proof: "decide(managerB, 'leave', own.body.id, 'approve')).status).toBe(403)",
  },
  'AttendanceRequestsController.reject': {
    reason: "Same decider rule as approve (AttendanceRequestsService.decide).",
    test: 'modules/attendance/phase-21-task-4-leave-corrections.spec.ts',
    proof: "decide(managerB, 'leave', own.body.id, 'approve')).status).toBe(403)",
  },
  'AttendanceRequestsController.forward': {
    reason: "Only the person's own Team Lead forwards (personIsUnder).",
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: "another team's Team Lead cannot forward a leave request",
  },

  // ---------------------------------------------------------------- flags and requests
  'ReviewFlagController.resolve': {
    reason: "A Team Lead resolves only flags about their own team's people (assertCanResolve).",
    test: 'modules/review-flag/review-flag.spec.ts',
    proof: "TL2 trying to resolve TL1 flag",
  },
  'RequestsController.resolveFlag': {
    reason: 'Only the flag owner in the caller\'s team or tree resolves it (FlagEscalationService).',
    test: 'modules/screens-manager/screens-manager.e2e.spec.ts',
    proof: '/manager/flags/${flagIds[1]}/resolve`, { resolution: \'checked\' })).status).toBe(403)',
  },
  'RequestsController.escalateFlag': {
    reason: 'Only the flag owner sends it up, one level at a time, inside their team or tree.',
    test: 'modules/screens-manager/screens-manager.e2e.spec.ts',
    proof: '/manager/flags/${flagIds[1]}/resolve`, { resolution: \'checked\' })).status).toBe(403)',
  },
  'RequestsController.get': {
    reason: "A request outside the caller's team or tree is not found (RequestsService.one).",
    test: 'modules/requests/requests.e2e.spec.ts',
    proof: "expect((await get(leadB, `/requests/${ref}`)).status).toBe(404)",
  },
  'RequestsController.decide': {
    reason: 'Only the decider the request is waiting with, in their team or tree.',
    test: 'modules/requests/requests.e2e.spec.ts',
    proof: "expect((await post(leadA, `/requests/${ref}/decide`, { decision: 'approved' })).status).toBe(403)",
  },
  'RequestsController.forward': {
    reason: 'Only a Team Lead, for a request waiting with them in their own team.',
    test: 'modules/requests/requests.e2e.spec.ts',
    proof: "expect((await get(leadB, `/requests/${ref}`)).status).toBe(404)",
  },

  // ---------------------------------------------------------------- money and pay
  'PaymentController.resendPayment': {
    reason: 'Agents reach job seekers city-wide (role table); Team Leads and Managers are not admitted.',
    test: 'modules/finance/finance.e2e.spec.ts',
    proof: "/payments/00000000-0000-0000-0000-000000000000/resend').set(as('finance')).expect(404)",
  },
  'PayrollSelfController.one': {
    reason: "The parameter is a month: the caller's own payslip only.",
    test: 'modules/finance/finance-b.e2e.spec.ts',
    proof: "get(`/payroll/my-payslips/${MONTH}`).set(as('bala')).expect(404)",
  },

  // ---------------------------------------------------------------- sessions, codes, devices, staff
  'StaffSessionController.revokeSession': {
    reason: "Below Manager: only one's own sessions; Managers their tree (AuthService.revokeSession).",
    test: 'common/auth/manager-session-scope.spec.ts',
    proof: "below Manager: only their own sessions; another person’s session is 403",
  },
  'LoginCodeController.reveal': {
    reason: "A Team Lead reveals codes only for their own team's people.",
    test: 'modules/login-code/login-code.spec.ts',
    proof: '.post(`/login-codes/${other.id}/reveal`)',
  },
  'LoginCodeController.refuse': {
    reason: 'Same rule as reveal (LoginCodeService.assertCanHandle).',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: "another team's Team Lead cannot refuse a login code",
  },
  'StaffController.setCallRoutingPhone': {
    reason: 'Oneself, management, or the Team Lead of that person (StaffService.setCallRoutingPhone).',
    test: 'modules/staff/hidden-numbers.spec.ts',
    proof: 'expect(otherLeadRes.status).toBe(403)',
  },
  'StaffDeviceController.approve': {
    reason: "A Team Lead decides only their own team's devices (StaffDeviceService.assertCanDecide).",
    test: 'modules/staff/staff-device.spec.ts',
    proof: '.expect(403)',
  },
  'StaffDeviceController.revoke': {
    reason: 'Same rule as approve.',
    test: 'modules/staff/staff-device.spec.ts',
    proof: '.expect(403)',
  },

  // ---------------------------------------------------------------- calls, missed calls, follow-ups
  'CallController.recording': {
    reason: "CallAccessGuard: a Team Lead hears only their team's calls; agents are not admitted.",
    test: 'modules/call/call-access.guard.spec.ts',
    proof: "a Team Lead opens their own and their team\\'s calls",
  },
  'CallController.getOne': {
    reason: 'CallAccessGuard: agents their own calls, Team Leads their team\'s.',
    test: 'modules/call/call-access.guard.spec.ts',
    proof: 'a call or field agent opens only calls they made',
  },
  'CallController.outcome': {
    reason: 'CallAccessGuard, and the service records an outcome only for the person who made the call.',
    test: 'modules/call/call-access.guard.spec.ts',
    proof: 'guards every /calls/:id route',
  },
  'CallController.updateNotes': {
    reason: 'CallAccessGuard, and the edit rule on call records.',
    test: 'modules/call/call-access.guard.spec.ts',
    proof: 'guards every /calls/:id route',
  },
  'TelephonyController.assignCallback': {
    reason: 'TelephonyService: agents only unassigned or their own missed calls, Team Leads within their team.',
    test: 'modules/telephony/callback-team-scope.spec.ts',
    proof: 'cannot move one someone else holds',
  },
  'TelephonyController.completeCallback': {
    reason: 'TelephonyService: agents their own or unassigned, Team Leads their team\'s.',
    test: 'modules/telephony/callback-team-scope.spec.ts',
    proof: 'complete only their own or unassigned missed calls',
  },
  'InterviewController.recordCallReply': {
    reason: "The reply is recorded on the caller's own answered offer call (CallService.recordOutcome: maker only).",
    test: 'modules/call/click-to-call.spec.ts',
    proof: "set('Authorization', `Bearer ${tokenFor(otherAgent)}`)",
  },
  'FollowUpController.getIntroducedBusinesses': {
    reason: 'Only introductions by the caller or their team, unless the task is theirs (FollowUpService).',
    test: 'modules/follow-up/introduced-businesses-scope.spec.ts',
    proof: 'out of scope: a Team Lead with nothing in scope gets 403',
  },
  'FollowUpController.complete': {
    reason: 'Agents only follow-ups assigned to them, Team Leads their team\'s (assertMayComplete).',
    test: 'modules/follow-up/introduced-businesses-scope.spec.ts',
    proof: 'a call or field agent completes only follow-ups assigned to them',
  },
  'GrowthController.declineWinBack': {
    reason: "A Team Lead declines only their own team's job seekers; call agents work the city-wide list.",
    test: 'modules/growth/growth-proposals.spec.ts',
    proof: '/growth/win-back/${entry.id}/decline`, staff.lead2',
  },

  // ---------------------------------------------------------------- field selling (Laboura Field)
  'FieldSellingController.business': {
    reason: 'Field agents act only on their own account businesses (FieldSellingService.assertActsOnBusiness).',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.matches': {
    reason: "The vacancy must be at the field agent's own account business (vacancyFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.noMore': {
    reason: "The vacancy must be at the field agent's own account business (vacancyFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.booking': {
    reason: "The vacancy must be at the field agent's own account business (vacancyFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: "send({ vacancyId: vacancy.id, jobSeekerId: yes.id }).expect(403)",
  },
  'FieldSellingController.candidate': {
    reason: 'Job seekers are city-wide for field agents (role table); the card shows no phone number.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.interview': {
    reason: "Only an interview at the field agent's own business (field-selling-screens).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.placement': {
    reason: "Only a placement at the field agent's own business (field-selling-screens).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.answer': {
    reason: 'Only the agent who made the call records the answer.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.handOver': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.ownerOtp': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.decision': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.meet': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.arrival': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.like': {
    reason: "The vacancy must be at the field agent's own account business (vacancyFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: "favourites/${yes.id}`).set('Authorization', `Bearer ${otherToken}`).expect(403)",
  },
  'FieldSellingController.unlike': {
    reason: "The vacancy must be at the field agent's own account business (vacancyFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: "favourites/${yes.id}`).set('Authorization', `Bearer ${otherToken}`).expect(403)",
  },
  'FieldSellingController.ownerCallOutcome': {
    reason: 'Only the agent who made the call records its outcome.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },
  'FieldSellingController.ownerSays': {
    reason: "Only a placement at the field agent's own business (assertActsOnBusiness).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '.expect(403)',
  },

  // ---------------------------------------------------------------- field visits
  'FieldVisitController.get': {
    reason: 'Only the field agent the visit is assigned to.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: "send(SHOP).expect(403)",
  },
  'FieldVisitController.outcome': {
    reason: 'Only the field agent the visit is assigned to.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: "send(SHOP).expect(403)",
  },
  'FieldVisitController.proof': {
    reason: 'Only the field agent the visit is assigned to.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: "send(SHOP).expect(403)",
  },
  'FieldVisitController.verify': {
    reason: 'Only the field agent the visit is assigned to completes it.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: "send(SHOP).expect(403)",
  },
  'FieldVisitController.arrived': {
    reason: 'Only the field agent attending that interview marks the candidate arrived.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: "send(SHOP).expect(403)",
  },
  'BusinessController.sendVisitOwnerOtp': {
    reason: 'Only the field agent the visit assignment is given to (BusinessVerificationService.sendOwnerOtp).',
    test: 'modules/business/business-verification.spec.ts',
    proof: '.expect(403)',
  },
  'ScreensFieldController.business': {
    reason: 'Field agents see every business on the map (guide); full details only for their own account businesses.',
    test: 'common/auth/app-roles.spec.ts',
    proof: "/field-work/businesses/BZ-NONE').set('Authorization', `Bearer ${token}`).expect(403)",
  },

  // ---------------------------------------------------------------- call agent console
  'ScreensCallRegistrationController.record': {
    reason: "The service opens a record only if the caller may read it (assertCanRead, OwnTeam for Team Leads).",
    test: 'modules/screens-call-registration/screens-call-registration.service.spec.ts',
    proof: 'denies a Team Lead a record outside their team',
  },
  'CallWorkController.profile': {
    reason: 'Call agents reach job seekers city-wide (role table); phone numbers come masked.',
    test: 'modules/screens-call-agent/call-work.spec.ts',
    proof: ".expect(403)",
  },
  'CallWorkController.jobs': {
    reason: 'Matching jobs for a job seeker: call agents work city-wide (role table).',
    test: 'modules/screens-call-agent/call-work.spec.ts',
    proof: ".expect(403)",
  },
  'CallWorkController.call': {
    reason: 'Only the call agent who made the call.',
    test: 'modules/screens-call-agent/call-work.spec.ts',
    proof: "/call-work/calls/${call.id}`).set('Authorization', `Bearer ${tokenFor(idleAgent)}`).expect(403)",
  },
  'CallWorkController.followUp': {
    reason: "Only a follow-up on the call agent's own list.",
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: "another call agent cannot open a follow-up that is not on their list",
  },
  'CallWorkController.incoming': {
    reason: 'Only a missed call that rang this call agent.',
    test: 'modules/screens-call-agent/call-work.spec.ts',
    proof: '.expect(403)',
  },

  // ---------------------------------------------------------------- Team Lead portal
  'TeamLeadController.agent': {
    reason: "Only an agent in the Team Lead's own team; others are 404.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "get(lead, `/team-lead/agents/${outsider.id}`)).status).toBe(404)",
  },
  'TeamLeadController.addNote': {
    reason: "Only an agent in the Team Lead's own team; others are 404.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "post(otherLead, `/team-lead/agents/${caller.id}/notes`, { text: 'x' })).status).toBe(404)",
  },
  'TeamLeadController.moveBusiness': {
    reason: "Only a business of the Team Lead's own team, to an agent of their own team.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "post(otherLead, `/team-lead/businesses/${business.id}/move`, { toStaffId: fielder2.id })).status).toBe(403)",
  },
  'TeamLeadController.selfie': {
    reason: "Only a registration by the Team Lead's own team.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "post(otherLead, `/team-lead/registrations/${seeker.id}/check`, { verdict: 'ok' })).status).toBe(404)",
  },
  'TeamLeadController.checkRegistration': {
    reason: "Only a registration by the Team Lead's own team.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "post(otherLead, `/team-lead/registrations/${seeker.id}/check`, { verdict: 'ok' })).status).toBe(404)",
  },
  'TeamLeadController.visitPhotos': {
    reason: "Only a visit by the Team Lead's own team.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "get(otherLead, `/team-lead/visits/${visit.id}/photos`)).status).toBe(404)",
  },
  'TeamLeadController.checkVisit': {
    reason: "Only a visit by the Team Lead's own team.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "get(otherLead, `/team-lead/visits/${visit.id}/photos`)).status).toBe(404)",
  },
  'TeamLeadController.score': {
    reason: "Only a call made by the Team Lead's own team.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "post(lead, `/team-lead/quality/${theirs.id}/score`",
  },
};
