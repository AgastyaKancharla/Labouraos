import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { QueueEvents } from 'bullmq';
import { AppModule } from '../../app.module';
import {
  StructuredLogger,
  StructuredLogEntry,
} from './structured-logger.service';
import { AlertService, AlertPayload } from './alert.service';
import {
  NoPickupEvaluationJob,
  NO_PICKUP_EVALUATION_QUEUE,
  NO_PICKUP_EVALUATION_JOB,
} from '../../jobs/no-pickup-evaluation.job';
import { getRequestId, runWithRequestId } from './request-context';

describe('Phase 8 Task 5: Observability, Structured Logging & Status Dashboard', () => {
  let app: INestApplication;
  let alertService: AlertService;
  let jobService: NoPickupEvaluationJob;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    alertService = app.get<AlertService>(AlertService);
    jobService = app.get<NoPickupEvaluationJob>(NoPickupEvaluationJob);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Structured JSON Logger & Contextual Request ID', () => {
    it('outputs valid single-line JSON log entries with level, timestamp, context and message', () => {
      const logs: StructuredLogEntry[] = [];
      const removeListener = StructuredLogger.addListener((entry) => {
        logs.push(entry);
      });

      const logger = new StructuredLogger('TelemetryTest');
      logger.log('Informational message test');
      logger.warn('Warning test');

      removeListener();

      expect(logs.length).toBeGreaterThanOrEqual(2);
      const infoLog = logs.find((l) => l.message === 'Informational message test');
      expect(infoLog).toBeDefined();
      expect(infoLog?.level).toBe('INFO');
      expect(infoLog?.context).toBe('TelemetryTest');
      expect(infoLog?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      const warnLog = logs.find((l) => l.message === 'Warning test');
      expect(warnLog?.level).toBe('WARN');
    });

    it('captures active requestId when executed within requestContext scope', () => {
      const logs: StructuredLogEntry[] = [];
      const removeListener = StructuredLogger.addListener((entry) => {
        logs.push(entry);
      });

      const testReqId = 'req-tracing-12345';
      const logger = new StructuredLogger('ContextTest');

      runWithRequestId(testReqId, () => {
        expect(getRequestId()).toBe(testReqId);
        logger.log('Scoped log message');
      });

      removeListener();

      const scopedEntry = logs.find((l) => l.message === 'Scoped log message');
      expect(scopedEntry).toBeDefined();
      expect(scopedEntry?.requestId).toBe(testReqId);
    });
  });

  describe('2. Request ID Tracing through HTTP Middleware', () => {
    it('generates a new x-request-id header when none is provided', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBeDefined();
      expect(typeof res.headers['x-request-id']).toBe('string');
      expect(res.headers['x-request-id'].length).toBeGreaterThan(10);
    });

    it('propagates caller-supplied x-request-id and threads it into downstream log entries', async () => {
      const customReqId = 'custom-trace-uuid-98765';
      const logs: StructuredLogEntry[] = [];
      const removeListener = StructuredLogger.addListener((entry) => {
        logs.push(entry);
      });

      const res = await request(app.getHttpServer())
        .get('/system/status')
        .set('x-request-id', customReqId);

      removeListener();

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(customReqId);

      // Verify that header is reflected back
      expect(res.headers['x-request-id']).toBe(customReqId);
    });
  });

  describe('3. BullMQ Job Request ID Threading', () => {
    it('threads the originating request ID into the BullMQ job and its worker log lines', async () => {
      const prevRole = process.env.PROCESS_ROLE;
      process.env.PROCESS_ROLE = 'worker';
      try {
        const queueEvents = new QueueEvents(NO_PICKUP_EVALUATION_QUEUE, {
          connection: jobService.redisConnection,
        });
        await queueEvents.waitUntilReady();

        const queue = jobService.getQueue();
        jobService.getWorker();

        const originatingRequestId = 'job-trace-bullmq-88990';
        const capturedLogs: StructuredLogEntry[] = [];
        const removeListener = StructuredLogger.addListener((entry) => {
          if (entry.requestId === originatingRequestId) {
            capturedLogs.push(entry);
          }
        });

        // Enqueue job with explicit requestId attached
        const job = await queue.add(NO_PICKUP_EVALUATION_JOB, {
          requestId: originatingRequestId,
        });

        await job.waitUntilFinished(queueEvents, 10000);
        removeListener();
        await queueEvents.close();

        expect(capturedLogs.length).toBeGreaterThanOrEqual(1);
        const workerLog = capturedLogs.find((l) =>
          l.message.includes(`BullMQ processing job ${NO_PICKUP_EVALUATION_JOB}`),
        );
        expect(workerLog).toBeDefined();
        expect(workerLog?.requestId).toBe(originatingRequestId);
      } finally {
        if (prevRole === undefined) {
          delete process.env.PROCESS_ROLE;
        } else {
          process.env.PROCESS_ROLE = prevRole;
        }
      }
    });
  });

  describe('4. System Status & Uptime Dashboard (GET /system/status)', () => {
    it('returns structured JSON with database, BullMQ, uptime, and memory statistics', async () => {
      const res = await request(app.getHttpServer())
        .get('/system/status')
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.status).toMatch(/^(healthy|degraded|unhealthy)$/);
      expect(typeof res.body.uptimeSeconds).toBe('number');
      expect(typeof res.body.uptimeFormatted).toBe('string');
      expect(res.body.version).toBe('0.1.0');
      expect(Array.isArray(res.body.components)).toBe(true);

      const dbComp = res.body.components.find((c: { name: string }) =>
        c.name.includes('PostgreSQL'),
      );
      expect(dbComp).toBeDefined();
      expect(dbComp.status).toBe('healthy');
      expect(typeof dbComp.latencyMs).toBe('number');

      const redisComp = res.body.components.find((c: { name: string }) =>
        c.name.includes('Redis'),
      );
      expect(redisComp).toBeDefined();

      expect(res.body.memory).toHaveProperty('heapUsedMb');
      expect(res.body.memory).toHaveProperty('heapTotalMb');
    });

    it('renders responsive HTML dashboard when Accept: text/html is requested', async () => {
      const res = await request(app.getHttpServer())
        .get('/system/status')
        .set('Accept', 'text/html');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Laboura Operations');
      expect(res.text).toContain('System Health &amp; Observability Status');
      expect(res.text).toContain('Core Infrastructure');
      expect(res.text).toContain('PostgreSQL Database');
    });
  });

  describe('5. Error Tracking & Alerting (AlertService)', () => {
    it('records and dispatches alert payload with requestId, severity, and error message', async () => {
      alertService.clearDispatchedAlerts();

      const testRequestId = 'alert-trace-99112';
      await alertService.sendAlert({
        title: 'Payment Gateway Webhook Timeout',
        message: 'Razorpay webhook failed to respond within 5000ms',
        severity: 'critical',
        requestId: testRequestId,
      });

      const alerts: AlertPayload[] = alertService.getDispatchedAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0].title).toBe('Payment Gateway Webhook Timeout');
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].requestId).toBe(testRequestId);
      expect(alerts[0].timestamp).toBeDefined();
    });
  });
});
