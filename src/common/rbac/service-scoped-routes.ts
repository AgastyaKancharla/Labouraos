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

  // ---------------------------------------------------------------- ID check (PR #135)
  'AadhaarQrController.view': {
    reason:
      "A Team Lead opens a person's ID check only for their own team's registrations (IdCheckAccessService) or, under rev 169, one they may check for another team of their city (OtherIdApprovalService); anything else is 404. Every view is audited.",
    test: 'modules/aadhaar-qr/aadhaar-qr.e2e.spec.ts',
    proof: "expect((await get(otherLead, `/identity/job-seekers/${s.id}/aadhaar-check`)).status).toBe(404);",
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
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: 'TL from another team cannot reject an attendance request (403)',
  },
  'AttendanceRequestsController.forward': {
    reason: "Only the person's own Team Lead forwards (personIsUnder).",
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// POST /attendance/requests/:kind/:id/forward: TL from another team is refused (403)',
  },

  // ---------------------------------------------------------------- flags and requests
  'ReviewFlagController.resolve': {
    reason: "A Team Lead resolves only flags about their own team's people (assertCanResolve).",
    test: 'modules/review-flag/review-flag.spec.ts',
    proof: "TL2 trying to resolve TL1 flag",
  },
  'RequestsController.resolveFlag': {
    reason: 'Only the flag owner in the caller\'s team or tree resolves it (FlagEscalationService).',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// POST /requests/flags/:id/resolve: TL from another team is refused (404)',
  },
  'RequestsController.escalateFlag': {
    reason: 'Only the flag owner sends it up, one level at a time, inside their team or tree.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// POST /requests/flags/:id/escalate: TL from another team is refused (404)',
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
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: 'TL from another team cannot forward a request on the Requests screen (refused)',
  },

  // ---------------------------------------------------------------- money and pay
  'PaymentController.resendPayment': {
    reason: 'City-wide (role table): agents work with every job seeker; Team Leads and Managers are not admitted.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// POST /payments/:id/resend: agents (city-wide) and the CEO only; a Team Lead is refused (403)',
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
    proof: '// POST /login-codes/:id/refuse: TL from another team is refused (403)',
  },
  'PasswordResetApprovalController.reveal': {
    reason:
      "A reset code is revealed only by someone allowed to approve that person's reset (PasswordResetService.assertMayApprove): a Team Lead for their own agents, a Manager below Manager in their tree, a CEO for anyone else; never one's own.",
    test: 'modules/staff/password-reset.spec.ts',
    proof: "// POST /password-resets/:id/reveal: another team's Team Lead is refused (403)",
  },
  'PasswordResetApprovalController.refuse': {
    reason: 'Same rule as reveal (PasswordResetService.assertMayApprove).',
    test: 'modules/staff/password-reset.spec.ts',
    proof: "// POST /password-resets/:id/refuse: another team's Team Lead is refused (403)",
  },
  'StaffController.setCallRoutingPhone': {
    reason: 'Oneself, management, or the Team Lead of that person (StaffService.setCallRoutingPhone).',
    test: 'modules/staff/hidden-numbers.spec.ts',
    proof: 'expect(otherLeadRes.status).toBe(403)',
  },
  'StaffDeviceController.approve': {
    reason: "A Team Lead decides only their own team's devices (StaffDeviceService.assertCanDecide).",
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// POST /staff/devices/:id/approve: TL from another team is refused (403)',
  },
  'StaffDeviceController.revoke': {
    reason: 'Same rule as approve.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// POST /staff/devices/:id/revoke: TL from another team is refused (403)',
  },

  // ---------------------------------------------------------------- calls, missed calls, follow-ups
  'CallController.recording': {
    reason: "CallAccessGuard: a Team Lead hears only their team's calls; agents are not admitted.",
    test: 'modules/call/call-scope.e2e.spec.ts',
    proof: 'get(`/calls/${ids.callB}/recording`, tokens.TLA)',
  },
  'CallController.getOne': {
    reason: 'CallAccessGuard: agents their own calls, Team Leads their team\'s.',
    test: 'modules/call/call-scope.e2e.spec.ts',
    proof: 'get(`/calls/${ids.callB}`, tokens.CAA)',
  },
  'CallController.outcome': {
    reason: 'CallAccessGuard, and the service records an outcome only for the person who made the call.',
    test: 'modules/call/call-scope.e2e.spec.ts',
    proof: 'post(`/calls/${ids.callB}/outcome`, tokens.TLA',
  },
  'CallController.updateNotes': {
    reason: 'CallAccessGuard, and the edit rule on call records.',
    test: 'modules/call/call-scope.e2e.spec.ts',
    proof: '.patch(`/calls/${ids.callB}`)',
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
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: 'another agent cannot record a reply on someone else\'s offer call (POST /interviews/:id/call-reply, 403)',
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
    reason: 'City-wide read (role table): field agents see every business on the map; owner details only for the account agent.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: 'but GET /screens/field-selling/businesses/:id and /candidates/:id are for field agents only (403 to a Manager)',
  },
  'FieldSellingController.matches': {
    reason: 'Only a vacancy at the field agent\'s own account business, open visit or own lead (assertWorksOnBusiness); others 404.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// GET /screens/field-selling/vacancies/:id/matches: another field agent is refused (404)',
  },
  'FieldSellingController.noMore': {
    reason: 'Only a vacancy at the field agent\'s own account business, open visit or own lead (assertWorksOnBusiness); others 404.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// GET /screens/field-selling/vacancies/:id/no-more: another field agent is refused (404)',
  },
  'FieldSellingController.booking': {
    reason: 'Only a vacancy at the field agent\'s own account business, open visit or own lead (assertWorksOnBusiness); others 404.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// GET /screens/field-selling/vacancies/:id/booking: another field agent is refused (404)',
  },
  'FieldSellingController.candidate': {
    reason: 'City-wide read (role table): job seekers are city-wide for field agents; the card shows no phone number.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: 'await get(`/screens/field-selling/candidates/${seeker.id}?vacancyId=${vacancy.id}`, tokenFor(manager)).expect(403);',
  },
  'FieldSellingController.interview': {
    reason: "Only an interview at the field agent's own business (field-selling-screens).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// GET /screens/field-selling/interviews/:id: another field agent is refused (403)',
  },
  'FieldSellingController.placement': {
    reason: "Only a placement at the field agent's own business (field-selling-screens).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// GET /screens/field-selling/placements/:id: another field agent is refused (403)',
  },
  'FieldSellingController.answer': {
    reason: 'Only the agent who made the call records the answer.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// POST /field-selling/calls/:id/answer: another field agent is refused (403)',
  },
  'FieldSellingController.handOver': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// POST /field-selling/interviews/:id/hand-over: another field agent is refused (403)',
  },
  'FieldSellingController.ownerOtp': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// POST /field-selling/interviews/:id/owner-otp: another field agent is refused (403)',
  },
  'FieldSellingController.decision': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// POST /field-selling/interviews/:id/decision: another field agent is refused (403)',
  },
  'FieldSellingController.meet': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// POST /field-selling/interviews/:id/meet: another field agent is refused (403)',
  },
  'FieldSellingController.arrival': {
    reason: "Only an interview at the field agent's own business (interviewFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// POST /field-selling/interviews/:id/arrival: another field agent is refused (403)',
  },
  'FieldSellingController.like': {
    reason: "The vacancy must be at the field agent's own account business (vacancyFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: "favourites/${yes.id}`).set('Authorization', `Bearer ${otherToken}`).expect(403)",
  },
  'FieldSellingController.unlike': {
    reason: "The vacancy must be at the field agent's own account business (vacancyFor).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// DELETE /field-selling/vacancies/:id/favourites/:jobSeekerId: another field agent is refused (403)',
  },
  'FieldSellingController.ownerCallOutcome': {
    reason: 'Only the agent who made the call records its outcome.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// POST /field-selling/owner-calls/:id/outcome: another field agent is refused (403)',
  },
  'FieldSellingController.ownerSays': {
    reason: "Only a placement at the field agent's own business (assertActsOnBusiness).",
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// POST /field-selling/placements/:id/owner-says: another field agent is refused (403)',
  },

  // ---------------------------------------------------------------- field visits
  'FieldVisitController.get': {
    reason: 'Only the field agent who started the visit (ownVisit); others 404.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: '// GET /field-visits/:id: another field agent is refused (404)',
  },
  'FieldVisitController.outcome': {
    reason: 'Only the field agent who started the visit (ownVisit); others 404.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: '// POST /field-visits/:id/outcome: another field agent is refused (404)',
  },
  'FieldVisitController.proof': {
    reason: 'Only the field agent who started the visit (ownVisit); others 404.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: '// POST /field-visits/:id/proof: another field agent is refused (404)',
  },
  'FieldVisitController.verify': {
    reason: 'Only the field agent who started the visit (ownVisit); others 404.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: '// POST /field-visits/:id/verify: another field agent is refused (404)',
  },
  'FieldVisitController.arrived': {
    reason: 'Only the field agent attending that interview marks the candidate arrived.',
    test: 'modules/field-visit/field-visits.spec.ts',
    proof: 'const path = `/field-visits/interviews/${interview.id}/arrived`;',
  },
  'BusinessController.sendVisitOwnerOtp': {
    reason: 'Only the field agent the visit assignment is given to (BusinessVerificationService.sendOwnerOtp).',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: 'another field agent cannot ask for the owner OTP on a visit given to someone else (403)',
  },
  'ScreensFieldController.business': {
    reason: 'City-wide read (role table): field agents see every business on the map (guide); full details only for their own; other roles 403.',
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
    reason: 'City-wide read (role table): call agents work with every job seeker; phone numbers come masked; other roles 403.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /call-work/people/:ref: for call agents only (403 to a Team Lead)',
  },
  'CallWorkController.jobs': {
    reason: 'City-wide read (role table): matching jobs for any job seeker, for call agents only.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /call-work/people/:ref/jobs: for call agents only (403 to a Team Lead)',
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
    proof: '// GET /call-work/incoming/:callbackTaskId: a call agent it did not ring is refused (403)',
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
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /team-lead/registrations/:id/selfie: TL from another team is refused (404)',
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
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// POST /team-lead/visits/:id/check: TL from another team is refused (404)',
  },
  'TeamLeadController.score': {
    reason: "Only a call made by the Team Lead's own team.",
    test: 'modules/screens-team-lead/team-lead.e2e.spec.ts',
    proof: "post(lead, `/team-lead/quality/${theirs.id}/score`",
  },

  // ---------------------------------------------------------------- app sign-ups (customer app)
  'SignupTrackerController.reassign': {
    reason: "A Team Lead moves only their own team's sign-ups (OwnTeam: assigned agent, else the record's registering agent) and only to their own call agents; a no-team sign-up is for Managers and the CEO.",
    test: 'modules/signup-tracker/signup-tracker.e2e.spec.ts',
    proof: "post(`/signup-tracker/${noTeam.id}/reassign`).set('Authorization', `Bearer ${token(lead1)}`)",
  },
  'SignupTrackerController.assignVisit': {
    reason: "A Team Lead assigns a business sign-up visit only for their own team's business (businessOwners, else the suggested field agent's team) and only to their own field agent.",
    test: 'modules/signup-tracker/signup-tracker.e2e.spec.ts',
    proof: "post(`/signup-tracker/visit-requests/${va1.id}/assign`).set('Authorization', `Bearer ${token(lead2)}`)",
  },
};

/**
 * Staff or record ids taken from the query or the body (not the path) on
 * routes Team Leads or agents can reach, whose scope the service applies.
 * Keyed 'Controller.handler query:name' (or 'body:name'); same fields as above.
 */
export const SERVICE_SCOPED_INPUTS: Record<string, ServiceScopedRoute> = {
  'TargetController.getOverview query:staffId': {
    reason: 'A Team Lead only their own team\'s agents, an agent only themselves (TargetOverviewService).',
    test: 'modules/target/target-overview.spec.ts',
    proof: 'team lead attempting to access an agent on another team throws 403 Forbidden',
  },
  'TargetController.getDashboard query:staffId': {
    reason: 'Same service and rule as the overview (TargetOverviewService.getOverview).',
    test: 'modules/target/target-overview.spec.ts',
    proof: 'agent attempting to access another staff member throws 403 Forbidden',
  },
  'TargetController.getMoneyAtRisk query:staffId': {
    reason: 'A Team Lead only their own team\'s agents, an agent only themselves (MoneyAtRiskService).',
    test: 'modules/target/money-at-risk.spec.ts',
    proof: 'refuses team lead accessing agent outside their team (403 Forbidden)',
  },
  'TargetController.findAll query:staffId': {
    reason: 'A Team Lead only their own team\'s agents, an agent only themselves (TargetService.listTargets).',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /targets?staffId=: TL from another team is refused (403)',
  },
  'AttendanceController.month query:staffId': {
    reason: 'The person, their Team Lead or Manager, Finance or the CEO (AttendanceDaysService).',
    test: 'modules/attendance/phase-21-task-3-day-rules.spec.ts',
    proof: 'for (const viewer of [leadB, managerB, agentB]) {',
  },
  'AttendanceRequestsController.balance query:staffId': {
    reason: 'The person, their Team Lead or Manager, Finance or the CEO.',
    test: 'modules/attendance/phase-21-task-4-leave-corrections.spec.ts',
    proof: 'expect((await get(leadB, `/attendance/leave/balance?staffId=${mid.id}`)).status).toBe(403);',
  },
  'AttendanceReportsController.report query:staffId': {
    reason: 'Only people in the caller\'s team or tree.',
    test: 'modules/attendance/phase-21-task-5-attendance-reports.spec.ts',
    proof: 'expect((await get(leadB, `/attendance/report?staffId=${agentA3.id}&from=2027-06-08&to=2027-06-09`)).status).toBe(403);',
  },
  'MessageController.list query:subjectId': {
    reason: 'A Team Lead reads messages only about their own team\'s job seekers (MessagingService.canRead).',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /messages?subjectId=: TL from another team is refused (403)',
  },
  'StaffSessionController.listSessions query:staffId': {
    reason: 'Ignored below Manager: Team Leads and agents only ever see their own sessions.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /staff/sessions?staffId=: ignored below Manager, a Team Lead sees only their own (not.toContain)',
  },
  'CallController.list query:subjectId': {
    reason: 'The list holds only calls by the caller (agents) or their own team (Team Leads).',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /calls?subjectId=: another team\'s calls are left out (not.toContain)',
  },
  'InterviewController.list query:agentId': {
    reason: 'An agent only their own interviews; a Team Lead only their own team\'s agents.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /interviews?agentId=: TL from another team is refused (403)',
  },
  'InterviewController.list query:vacancyId': {
    reason: 'Only narrows the list, which holds only interviews proposed by the caller or their team.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /interviews?vacancyId=: another team\'s interviews are left out (not.toContain)',
  },
  'FieldSellingController.booking query:jobSeekerId': {
    reason: 'Job seekers are city-wide for field agents (role table); the vacancy\'s business is checked (assertWorksOnBusiness).',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// ?jobSeekerId on the booking route may name any job seeker (city-wide); the vacancy\'s business decides (404 below)',
  },
  'FieldSellingController.candidate query:vacancyId': {
    reason: 'City-wide read (role table): the vacancy only adds the fit to the card.',
    test: 'modules/field-selling/field-selling.spec.ts',
    proof: '// ?vacancyId on the candidate card only adds the fit to that vacancy; the card is a field-agent-only read (403 to a Manager)',
  },
  'BusinessController.assignVisit body:assignedStaffId': {
    reason: 'A Team Lead gives a visit only to a field agent of their own team (assertTeamLeadPicksOwnAgent).',
    test: 'common/rbac/own-team.spec.ts',
    proof: '// body:assignedStaffId on POST /businesses/:businessId/visit-assignments/:assignmentId/assign: another team\'s agent is refused',
  },
  'BusinessController.approveVerification body:accountAgentId': {
    reason: 'A Team Lead who names an account agent picks one from their own team (assertTeamLeadPicksOwnAgent).',
    test: 'common/rbac/own-team.spec.ts',
    proof: '// body:accountAgentId on POST /businesses/:id/verification/approve: another team\'s agent is refused',
  },
  'BusinessController.reassignAccountAgent body:accountAgentId': {
    reason: 'A Team Lead moves an account only to a field agent of their own team (assertTeamLeadPicksOwnAgent).',
    test: 'common/rbac/own-team.spec.ts',
    proof: '// body:accountAgentId on POST /businesses/:id/account-agent: another team\'s agent is refused',
  },
  'StatusHistoryController.getHistory query:subjectId': {
    reason: 'A Team Lead sees a trail only about or changed by their own team; anything else answers empty.',
    test: 'common/rbac/service-scoped-routes.e2e.spec.ts',
    proof: '// GET /status-history?subjectId=: another team\'s history answers empty (toEqual([]))',
  },
};
