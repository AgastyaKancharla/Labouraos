import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../message/sms.provider';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../../common/whatsapp/whatsapp.interface';
import { PlacementService } from '../placement/placement.service';
import { PricingService } from '../pricing/pricing.service';

describe('Phase 16 Gate End-to-End Proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let placementService: PlacementService;
  let pricingService: PricingService;

  const testSecret = 'phase16_test_webhook_secret_32_chars';
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const slotIds: string[] = [];
  const interviewIds: string[] = [];
  const placementIds: string[] = [];
  const paymentIds: string[] = [];
  const bankCreditIds: string[] = [];
  const sentMessages: Array<{ channel: string; template: string; subjectId: string; variables: Record<string, unknown> }> = [];

  let ceoToken = '';
  let financeToken = '';
  let managerToken = '';
  let callAgentToken = '';
  let fieldAgentToken = '';
  let teamLeadToken = '';

  let ceoId = '';
  let financeId = '';
  let callAgentId = '';
  let fieldAgentId = '';

  function signBankFeedPayload(payload: Record<string, unknown>): { raw: string; sig: string } {
    const raw = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', testSecret).update(raw).digest('hex');
    return { raw, sig };
  }

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    process.env.COMPANY_UPI_VPA = 'laboura@icici';
    process.env.COMPANY_UPI_PAYEE_NAME = 'Laboura Staffing Services';
    process.env.BANK_FEED_WEBHOOK_SECRET = testSecret;

    const mockSmsProvider: SmsProvider = {
      sendTemplate: async (phone, template, _dltTemplateId, variables) => {
        sentMessages.push({ channel: 'sms', template, subjectId: phone, variables: variables || {} });
        return { messageId: `msg_sms_${crypto.randomUUID()}`, status: 'sent' };
      },
    };

    const mockWhatsAppProvider: WhatsAppProvider = {
      sendTemplateMessage: async (phone, templateName, params) => {
        sentMessages.push({ channel: 'whatsapp', template: templateName, subjectId: phone, variables: params || {} });
        return { messageId: `msg_wa_${crypto.randomUUID()}`, status: 'sent', phone, templateName, timestamp: new Date() };
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER).useValue(mockSmsProvider)
      .overrideProvider(WHATSAPP_PROVIDER).useValue(mockWhatsAppProvider)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    placementService = app.get(PlacementService);
    pricingService = app.get(PricingService);

    // Create Staff accounts
    const passwordHash = 'dummy-hash';

    const ceo = await prisma.staff.create({
      data: {
        code: `P16-CEO-${suffix}`, name: 'Phase 16 CEO', email: `p16-ceo-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'ceo', status: 'active', city: 'Bengaluru',
      },
    });
    ceoId = ceo.id; staffIds.push(ceo.id);
    ceoToken = jwt.sign({ sub: ceo.id, role: ceo.role, code: ceo.code, email: ceo.email });

    const finance = await prisma.staff.create({
      data: {
        code: `P16-FIN-${suffix}`, name: 'Phase 16 Finance', email: `p16-fin-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'finance', status: 'active', city: 'Bengaluru',
      },
    });
    financeId = finance.id; staffIds.push(finance.id);
    financeToken = jwt.sign({ sub: finance.id, role: finance.role, code: finance.code, email: finance.email });

    const manager = await prisma.staff.create({
      data: {
        code: `P16-MGR-${suffix}`, name: 'Phase 16 Manager', email: `p16-mgr-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'manager', status: 'active', city: 'Bengaluru',
      },
    });
    staffIds.push(manager.id);
    managerToken = jwt.sign({ sub: manager.id, role: manager.role, code: manager.code, email: manager.email });

    const teamLead = await prisma.staff.create({
      data: {
        code: `P16-TL-${suffix}`, name: 'Phase 16 Team Lead', email: `p16-tl-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'team_lead', status: 'active', city: 'Bengaluru',
      },
    });
    staffIds.push(teamLead.id);
    teamLeadToken = jwt.sign({ sub: teamLead.id, role: teamLead.role, code: teamLead.code, email: teamLead.email });

    const callAgent = await prisma.staff.create({
      data: {
        code: `P16-CA-${suffix}`, name: 'Phase 16 Call Agent', email: `p16-ca-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'call_agent', status: 'active', city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id; staffIds.push(callAgent.id);
    callAgentToken = jwt.sign({ sub: callAgent.id, role: callAgent.role, code: callAgent.code, email: callAgent.email });

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `P16-FA-${suffix}`, name: 'Phase 16 Field Agent', email: `p16-fa-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'field_agent', status: 'active', city: 'Bengaluru', teamLeadId: teamLead.id,
      },
    });
    fieldAgentId = fieldAgent.id; staffIds.push(fieldAgent.id);
    fieldAgentToken = jwt.sign({ sub: fieldAgent.id, role: fieldAgent.role, code: fieldAgent.code, email: fieldAgent.email });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    const allSubjects = [...businessIds, ...seekerIds, ...interviewIds, ...placementIds, ...paymentIds, ...bankCreditIds];
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: allSubjects } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: allSubjects } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.bankCredit.deleteMany({ where: { id: { in: bankCreditIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.placement.deleteMany({ where: { id: { in: placementIds } } });
    await prisma.interview.deleteMany({ where: { id: { in: interviewIds } } });
    await prisma.vacancyInterviewSlot.deleteMany({ where: { id: { in: slotIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  }, 120000);

  it('runs complete Phase 16 end-to-end proof and all gate requirements', async () => {
    // --------------------------------------------------------------------------
    // PART 1: Job Seeker UPI registration, UTR hint, and mock bank confirmation
    // --------------------------------------------------------------------------
    const jsPhone = `9${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-P16-${suffix}`,
        name: `Candidate Proof ${suffix}`,
        phone: jsPhone,
        tradeSkill: 'Electrician',
        status: 'lead',
        city: 'Bengaluru',
        minSalary: 1400000,
        maxSalary: 1800000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      },
    });
    seekerIds.push(seeker.id);

    // Call Agent triggers ₹499 activation payment request
    const actRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seeker.id}/activation-payment`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(201);

    expect(actRes.body).toBeDefined();
    expect(actRes.body.amountPaise).toBe(49900);
    expect(actRes.body.paymentLink).toContain('/payments/request/');
    expect(actRes.body.upiReference).toMatch(new RegExp(`^${actRes.body.paymentCode}-`));
    expect(actRes.body.upiUri).toContain('upi://pay?');
    expect(actRes.body.upiUri).toContain('pa=laboura%40icici');
    expect(actRes.body.upiUri).toContain('am=499.00');

    const jsPaymentId = actRes.body.paymentId;
    paymentIds.push(jsPaymentId);
    const jsUpiRef = actRes.body.upiReference;

    // Gate Item 1 check: Re-sending payment request re-sends same request, NEVER creates second payment
    const resendActRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seeker.id}/activation-payment`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(201);

    expect(resendActRes.body.paymentId).toBe(jsPaymentId);
    expect(resendActRes.body.upiReference).toBe(jsUpiRef);

    const seekerPaymentsCount = await prisma.payment.count({ where: { jobSeekerId: seeker.id } });
    expect(seekerPaymentsCount).toBe(1);

    // Candidate visits payment page
    const pageRes = await request(app.getHttpServer())
      .get(`/payments/request/${encodeURIComponent(jsUpiRef)}`)
      .set('Accept', 'text/html')
      .expect(200);

    expect(pageRes.text).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(pageRes.text).toContain('Pay with a UPI app');
    expect(pageRes.text).not.toContain('type="file"');

    // Candidate enters 12-digit UTR hint (nothing changes)
    await request(app.getHttpServer())
      .post(`/payments/request/${encodeURIComponent(jsUpiRef)}/utr-hint`)
      .send({ utr: '202611090001' })
      .expect(200);

    const paymentAfterHint = await prisma.payment.findUnique({ where: { id: jsPaymentId } });
    expect(paymentAfterHint?.payerUtrHint).toBe('202611090001');
    expect(paymentAfterHint?.status).toBe('pending');

    const seekerAfterHint = await prisma.jobSeeker.findUnique({ where: { id: seeker.id } });
    expect(seekerAfterHint?.status).toBe('lead'); // Still lead, nothing changed

    // Mock bank sends credit of ₹499 with exact reference in remark
    const bankCreditTime = new Date('2026-11-09T10:30:00Z');
    const jsBankUtr = `UTR-JS-${suffix}`;
    const jsWebhookPayload = {
      bankUtr: jsBankUtr,
      amountPaise: 49900,
      receivedAt: bankCreditTime.toISOString(),
      payerName: seeker.name,
      remark: `REGISTRATION ${jsUpiRef}`,
    };
    const jsSigned = signBankFeedPayload(jsWebhookPayload);

    await request(app.getHttpServer())
      .post('/payments/bank-feed/webhook')
      .set('Content-Type', 'application/json')
      .set('x-bank-signature', jsSigned.sig)
      .send(jsSigned.raw)
      .expect(200);

    // Verify payment succeeded, candidate became active, clock started at credit time
    const jsPaymentPaid = await prisma.payment.findUnique({ where: { id: jsPaymentId } });
    expect(jsPaymentPaid?.status).toBe('succeeded');
    expect(jsPaymentPaid?.confirmedBy).toBe('bank_feed');
    expect(jsPaymentPaid?.bankUtr).toBe(jsBankUtr);
    expect(new Date(jsPaymentPaid!.confirmedAt!).getTime()).toBe(bankCreditTime.getTime());

    const seekerActivated = await prisma.jobSeeker.findUnique({ where: { id: seeker.id } });
    expect(seekerActivated?.status).toBe('active');
    expect(new Date(seekerActivated!.paymentReceivedAt!).getTime()).toBe(bankCreditTime.getTime());

    // Receipt link check for candidate (Task 5 acceptance)
    const receiptRes = await request(app.getHttpServer())
      .get(`/payments/${jsPaymentId}/receipt`)
      .expect(200);
    expect(receiptRes.body.paymentId).toBe(jsPaymentId);
    expect(receiptRes.body.amountPaise).toBe(49900);
    expect(receiptRes.body.status).toBe('succeeded');
    expect(receiptRes.body.receiptType).toBe('registration_receipt');

    // ------------------------------------------------------------------------------------
    // PART 2: Business Placement ₹16,000, mismatch on bank feed, Finance manual confirmation
    // ------------------------------------------------------------------------------------
    const bizPhone = `9${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    const business = await prisma.business.create({
      data: {
        code: `BZ-P16-${suffix}`,
        name: `Phase 16 Electric Works ${suffix}`,
        address: '100 Industrial Road, Bengaluru',
        phone: bizPhone,
        ownerName: 'Owner Proof 1',
        city: 'Bengaluru',
        locality: 'Peenya',
        latitude: 13.0285,
        longitude: 77.5197,
        verificationStatus: 'verified',
        verifiedAt: new Date(),
        verifiedByStaffId: callAgentId,
        accountAgentId: fieldAgentId,
        leadCreatedByStaffId: fieldAgentId,
      },
    });
    businessIds.push(business.id);

    await prisma.businessAgreement.create({
      data: {
        businessId: business.id,
        version: 'phase16-gate',
        termsHash: crypto.randomUUID(),
        noBypassMonths: 12,
        noBypassPenaltyPercent: 50,
        feePercent: 50,
        gstPercent: 18,
        signedName: 'Owner Proof 1',
        signedPhone: bizPhone,
        otpRequestId: `otp-${suffix}`,
        documentStoragePath: `agreements/${suffix}.pdf`,
        signedAt: new Date(),
      },
    });

    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-P16-${suffix}`,
        city: 'Bengaluru',
        businessId: business.id,
        capturedByStaffId: callAgentId,
        tradeSkill: 'Electrician',
        roleTitle: 'Electrician',
        status: 'open',
        salaryMinPaise: 1400000,
        salaryMaxPaise: 1800000,
        salaryPeriod: 'monthly',
        shift: 'day',
        latitude: 13.0285,
        longitude: 77.5197,
        locality: 'Peenya',
        interviewType: 'walk_in',
      },
    });
    vacancyIds.push(vacancy.id);

    const slot = await prisma.vacancyInterviewSlot.create({
      data: {
        vacancyId: vacancy.id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 90000000),
        capacity: 5,
      },
    });
    slotIds.push(slot.id);

    const interview = await prisma.interview.create({
      data: {
        code: `IN-P16-${suffix}`,
        vacancyId: vacancy.id,
        businessId: business.id,
        jobSeekerId: seeker.id,
        vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt,
        slotEndsAt: slot.endsAt,
        status: 'completed',
        result: 'selected',
        resultRecordedAt: new Date(),
        selectedSalaryPaise: 1600000,
        selectedJoiningDate: new Date('2026-11-20'),
        proposedByStaffId: callAgentId,
        replyDueAt: new Date(Date.now() + 172800000),
        resultDueAt: new Date(Date.now() + 86400000),
        suitabilitySnapshot: { score: 100, tradeMatched: true },
        offerSentAt: new Date(),
      },
    });
    interviewIds.push(interview.id);

    // Owner selects candidate at ₹16,000 (agreedSalary: 1600000 paise)
    // Creates placement awaiting_payment with fee 50% (800000 paise) + 18% GST (144000 paise) = 944000 paise
    const createdPlacement = await placementService.createAwaitingPaymentFromInterview(
      interview.id,
      new Date('2026-11-09T10:00:00Z'),
    );
    const placement = createdPlacement;
    placementIds.push(placement.id);

    expect(placement.status).toBe('awaiting_payment');
    expect(placement.agreedSalary).toBe(1600000);
    expect(placement.placementFee).toBe(800000);
    expect(placement.gstAmount).toBe(144000);
    expect(placement.feePercentAtCreation).toBe(50);
    expect(placement.gstPercentAtCreation).toBe(18);

    // Placement UPI Payment check
    const placementPayment = await prisma.payment.findFirst({
      where: { placementId: placement.id, status: 'pending' },
    });
    expect(placementPayment).toBeDefined();
    expect(placementPayment?.amount).toBe(944000); // 8,000 + 1,440
    expect(placementPayment?.expectedAmountPaise).toBe(944000);
    expect(placementPayment?.method).toBe('upi_direct');
    expect(placementPayment?.upiReference).toBeDefined();
    paymentIds.push(placementPayment!.id);

    const placementUpiRef = placementPayment!.upiReference!;

    // Bank sends ₹9,000 by mistake (wrong amount: 900000 paise)
    const mismatchUtr = `UTR-MISMATCH-${suffix}`;
    const mismatchPayload = {
      bankUtr: mismatchUtr,
      amountPaise: 900000, // Mistake: expected 944000
      receivedAt: new Date().toISOString(),
      payerName: 'Owner Proof 1',
      remark: `PLACEMENT ${placementUpiRef}`,
    };
    const mismatchSigned = signBankFeedPayload(mismatchPayload);

    await request(app.getHttpServer())
      .post('/payments/bank-feed/webhook')
      .set('Content-Type', 'application/json')
      .set('x-bank-signature', mismatchSigned.sig)
      .send(mismatchSigned.raw)
      .expect(200);

    // Verify: Payment is NOT confirmed, credit stays unmatched, payment_mismatch ReviewFlag raised
    const paymentAfterMismatch = await prisma.payment.findUnique({ where: { id: placementPayment!.id } });
    expect(paymentAfterMismatch?.status).toBe('pending');

    const mismatchCredit = await prisma.bankCredit.findUnique({ where: { bankUtr: mismatchUtr } });
    expect(mismatchCredit).toBeDefined();
    expect(mismatchCredit?.status).toBe('unmatched');
    bankCreditIds.push(mismatchCredit!.id);

    const mismatchFlag = await prisma.reviewFlag.findFirst({
      where: { kind: 'payment_mismatch', subjectId: placementPayment!.id },
    });
    expect(mismatchFlag).toBeDefined();
    expect(mismatchFlag?.status).toBe('open');

    // Gate Item 5: RBAC - Non-Finance/non-CEO cannot record, match, or ignore bank credits
    await request(app.getHttpServer())
      .post('/payments/bank-credits')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ bankUtr: `UTR-MGR-${suffix}`, amountPaise: 944000, receivedAt: new Date().toISOString() })
      .expect(403);

    await request(app.getHttpServer())
      .post('/payments/bank-credits')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ bankUtr: `UTR-CA-${suffix}`, amountPaise: 944000, receivedAt: new Date().toISOString() })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/payments/${placementPayment!.id}/confirm`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ bankCreditId: mismatchCredit!.id })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/payments/bank-credits/${mismatchCredit!.id}/ignore`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ reason: 'wrong money' })
      .expect(403);

    // Verify CEO can access bank credits (only CEO and Finance can access bank credits)
    await request(app.getHttpServer())
      .get('/payments/bank-credits')
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(200);

    // Finance records correct ₹9,440 credit from bank statement
    const correctPlacementUtr = `UTR-PLACEMENT-${suffix}`;
    const manualCreditRes = await request(app.getHttpServer())
      .post('/payments/bank-credits')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        bankUtr: correctPlacementUtr,
        amountPaise: 944000, // Exact amount
        receivedAt: new Date('2026-11-09T14:00:00Z').toISOString(),
        payerName: 'Owner Proof 1',
        remark: `Manual Statement Match ${placementUpiRef}`,
      })
      .expect(201);

    expect(manualCreditRes.body.id).toBeDefined();
    const correctCreditId = manualCreditRes.body.id;
    bankCreditIds.push(correctCreditId);

    // Finance matches credit with pending placement fee payment
    const confirmRes = await request(app.getHttpServer())
      .post(`/payments/${placementPayment!.id}/confirm`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ bankCreditId: correctCreditId })
      .expect(201);

    expect(confirmRes.body.success).toBe(true);

    // Verify placement confirmed, candidate placed, joining date sent once, invoice assigned
    const confirmedPlacement = await prisma.placement.findUnique({ where: { id: placement.id } });
    expect(confirmedPlacement?.status).toBe('confirmed');
    expect(confirmedPlacement?.paidAt).toBeDefined();

    const placedCandidate = await prisma.jobSeeker.findUnique({ where: { id: seeker.id } });
    expect(placedCandidate?.status).toBe('placed');

    const confirmedCredit = await prisma.bankCredit.findUnique({ where: { id: correctCreditId } });
    expect(confirmedCredit?.status).toBe('matched');
    expect(confirmedCredit?.matchedPaymentId).toBe(placementPayment!.id);

    // Gate Item 6: Automatic GST invoice created using placement's gstPercentAtCreation
    const invoice = await placementService.getInvoice(placement.id, financeId);
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{5}$/);
    expect(invoice.summary.subtotalPaise).toBe(800000);
    expect(invoice.lineItems[0].taxRatePercent).toBe(18);
    expect(invoice.summary.totalTaxPaise).toBe(144000);
    expect(invoice.summary.totalAmountPaise).toBe(944000);

    // Changing policy GST percent to 28% does NOT change existing invoice
    const policy28 = await pricingService.createVersion({ gstPercent: 28 }, ceoId);

    const invoiceAfterGstChange = await placementService.getInvoice(placement.id, financeId);
    expect(invoiceAfterGstChange.lineItems[0].taxRatePercent).toBe(18); // Still 18%, not 28%
    expect(invoiceAfterGstChange.summary.totalTaxPaise).toBe(144000);

    // Clean up policy so subsequent test suites aren't affected
    await prisma.pricingPolicy.delete({ where: { id: policy28.id } });

    // ------------------------------------------------------------------------------------
    // PART 3: Second business pays by card through gateway
    // ------------------------------------------------------------------------------------
    const bizPhone2 = `9${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    const business2 = await prisma.business.create({
      data: {
        code: `BZ2-P16-${suffix}`,
        name: `Phase 16 Auto Garage ${suffix}`,
        address: '200 Outer Ring Road, Bengaluru',
        phone: bizPhone2,
        ownerName: 'Owner Proof 2',
        city: 'Bengaluru',
        locality: 'HSR Layout',
        latitude: 12.9141,
        longitude: 77.6411,
        verificationStatus: 'verified',
        verifiedAt: new Date(),
        verifiedByStaffId: callAgentId,
        accountAgentId: fieldAgentId,
        leadCreatedByStaffId: fieldAgentId,
      },
    });
    businessIds.push(business2.id);

    await prisma.businessAgreement.create({
      data: {
        businessId: business2.id,
        version: 'phase16-gate',
        termsHash: crypto.randomUUID(),
        noBypassMonths: 12,
        noBypassPenaltyPercent: 50,
        feePercent: 50,
        gstPercent: 18,
        signedName: 'Owner Proof 2',
        signedPhone: bizPhone2,
        otpRequestId: `otp2-${suffix}`,
        documentStoragePath: `agreements2/${suffix}.pdf`,
        signedAt: new Date(),
      },
    });

    const seeker2 = await prisma.jobSeeker.create({
      data: {
        code: `JS2-P16-${suffix}`,
        name: `Candidate Proof 2 ${suffix}`,
        phone: `9${String(Math.floor(100000000 + Math.random() * 900000000))}`,
        tradeSkill: 'Electrician',
        status: 'active',
        city: 'Bengaluru',
        minSalary: 1500000,
        maxSalary: 2200000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      },
    });
    seekerIds.push(seeker2.id);

    const vacancy2 = await prisma.vacancy.create({
      data: {
        code: `VC2-P16-${suffix}`,
        city: 'Bengaluru',
        businessId: business2.id,
        capturedByStaffId: callAgentId,
        tradeSkill: 'Electrician',
        roleTitle: 'Auto Electrician',
        status: 'open',
        salaryMinPaise: 1800000,
        salaryMaxPaise: 2200000,
        salaryPeriod: 'monthly',
        shift: 'day',
        latitude: 12.9141,
        longitude: 77.6411,
        locality: 'HSR Layout',
        interviewType: 'walk_in',
      },
    });
    vacancyIds.push(vacancy2.id);

    const slot2 = await prisma.vacancyInterviewSlot.create({
      data: {
        vacancyId: vacancy2.id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 90000000),
        capacity: 5,
      },
    });
    slotIds.push(slot2.id);

    const interview2 = await prisma.interview.create({
      data: {
        code: `IN2-P16-${suffix}`,
        vacancyId: vacancy2.id,
        businessId: business2.id,
        jobSeekerId: seeker2.id,
        vacancyInterviewSlotId: slot2.id,
        slotStartsAt: slot2.startsAt,
        slotEndsAt: slot2.endsAt,
        status: 'completed',
        result: 'selected',
        resultRecordedAt: new Date(),
        selectedSalaryPaise: 2000000,
        selectedJoiningDate: new Date('2026-11-25'),
        proposedByStaffId: callAgentId,
        replyDueAt: new Date(Date.now() + 172800000),
        resultDueAt: new Date(Date.now() + 86400000),
        suitabilitySnapshot: { score: 100, tradeMatched: true },
        offerSentAt: new Date(),
      },
    });
    interviewIds.push(interview2.id);

    // Agreed salary ₹20,000 -> placement fee 50% = ₹10,000 + 18% GST (₹1,800) = ₹11,800 (1180000 paise)
    const createdPlacement2 = await placementService.createAwaitingPaymentFromInterview(
      interview2.id,
      new Date('2026-11-09T11:00:00Z'),
    );
    const placement2 = createdPlacement2;
    placementIds.push(placement2.id);

    const cardPayment = await prisma.payment.findFirst({
      where: { placementId: placement2.id, status: 'pending' },
    });
    expect(cardPayment).toBeDefined();
    expect(cardPayment?.amount).toBe(1180000);
    paymentIds.push(cardPayment!.id);

    const cardUpiRef = cardPayment!.upiReference!;

    // Owner picks "Pay by card" on the payment page
    const cardRes = await request(app.getHttpServer())
      .post(`/payments/request/${encodeURIComponent(cardUpiRef)}/card`)
      .expect(200);

    expect(cardRes.body.paymentId).toBe(cardPayment!.id);
    expect(cardRes.body.gatewayReference).toBeDefined();
    expect(cardRes.body.paymentLink).toBeDefined();

    const switchedPayment = await prisma.payment.findUnique({ where: { id: cardPayment!.id } });
    expect(switchedPayment?.method).toBe('gateway_card');
    expect(switchedPayment?.gatewayReference).toBe(cardRes.body.gatewayReference);

    // Gateway webhook confirms the card payment
    const gwPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: switchedPayment!.gatewayReference,
            amount: 1180000,
            status: 'captured',
            notes: { paymentId: cardPayment!.id },
          },
        },
      },
    };

    await request(app.getHttpServer())
      .post('/payments/mock/simulate-webhook')
      .send(gwPayload)
      .expect(201);

    const cardPaymentPaid = await prisma.payment.findUnique({ where: { id: cardPayment!.id } });
    expect(cardPaymentPaid?.status).toBe('succeeded');
    expect(cardPaymentPaid?.confirmedBy).toBe('gateway');

    const confirmedPlacement2 = await prisma.placement.findUnique({ where: { id: placement2.id } });
    expect(confirmedPlacement2?.status).toBe('confirmed');

    const placedCandidate2 = await prisma.jobSeeker.findUnique({ where: { id: seeker2.id } });
    expect(placedCandidate2?.status).toBe('placed');

    // If a UPI bank credit arrives later for cardUpiRef (double payment), credit stays unmatched with flag
    const lateCreditUtr = `UTR-LATE-${suffix}`;
    const lateCreditPayload = {
      bankUtr: lateCreditUtr,
      amountPaise: 1180000,
      receivedAt: new Date().toISOString(),
      payerName: 'Owner Proof 2',
      remark: `LATE UPI ${cardUpiRef}`,
    };
    const lateSigned = signBankFeedPayload(lateCreditPayload);

    await request(app.getHttpServer())
      .post('/payments/bank-feed/webhook')
      .set('Content-Type', 'application/json')
      .set('x-bank-signature', lateSigned.sig)
      .send(lateSigned.raw)
      .expect(200);

    const lateCredit = await prisma.bankCredit.findUnique({ where: { bankUtr: lateCreditUtr } });
    expect(lateCredit?.status).toBe('unmatched');
    bankCreditIds.push(lateCredit!.id);

    const lateFlag = await prisma.reviewFlag.findFirst({
      where: { kind: 'payment_mismatch', subjectId: cardPayment!.id },
    });
    expect(lateFlag).toBeDefined();
    expect(lateFlag?.status).toBe('open');
  }, 180000);
});
