import * as fs from 'fs';
import * as path from 'path';

// Minimal type declaration for js-yaml in test
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml') as { load: (content: string) => unknown };

interface RenderEnvVar {
  key: string;
  value?: string;
  sync?: boolean;
  generateValue?: boolean;
  fromService?: {
    type: string;
    name: string;
    envVarKey: string;
  };
}

interface RenderService {
  type: string;
  name: string;
  runtime: string;
  buildCommand?: string;
  preDeployCommand?: string;
  startCommand?: string;
  healthCheckPath?: string;
  envVars?: RenderEnvVar[];
}

interface RenderBlueprint {
  services: RenderService[];
}

describe('Phase 6.5 Task 4: Deployment Configuration (render.yaml & DEPLOY.md)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const renderYamlPath = path.join(rootDir, 'render.yaml');
  const deployMdPath = path.join(rootDir, 'DEPLOY.md');

  let blueprint: RenderBlueprint;

  beforeAll(() => {
    expect(fs.existsSync(renderYamlPath)).toBe(true);
    expect(fs.existsSync(deployMdPath)).toBe(true);

    const fileContent = fs.readFileSync(renderYamlPath, 'utf8');
    blueprint = yaml.load(fileContent) as RenderBlueprint;
  });

  describe('1. Services Architecture', () => {
    it('declares exactly two services from this single codebase: a web service and a background worker', () => {
      expect(blueprint.services).toBeDefined();
      expect(blueprint.services.length).toBe(2);

      const types = blueprint.services.map((s) => s.type);
      expect(types).toContain('web');
      expect(types).toContain('worker');
    });

    it('configures web service with start:prod and background worker with start:worker', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');
      const workerService = blueprint.services.find((s) => s.type === 'worker');

      expect(webService).toBeDefined();
      expect(workerService).toBeDefined();

      expect(webService?.startCommand).toMatch(/npm run start:prod/);
      expect(workerService?.startCommand).toMatch(/npm run start:worker/);
    });

    it('points web service health check path at /health', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');
      expect(webService?.healthCheckPath).toBe('/health');
    });
  });

  describe('2. Database Migrations (Schema Creation)', () => {
    it('configures preDeployCommand for prisma migrate deploy on web service only', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');
      const workerService = blueprint.services.find((s) => s.type === 'worker');

      // Web service runs migrations before switching traffic
      expect(webService?.preDeployCommand).toBe('npx prisma migrate deploy');

      // Worker service must NOT run migrations to prevent concurrent execution conflicts
      expect(workerService?.preDeployCommand).toBeUndefined();
    });
  });

  describe('3. PROCESS_ROLE Gating & Environment Declarations', () => {
    it('explicitly declares PROCESS_ROLE=web on web service and PROCESS_ROLE=worker on worker service', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');
      const workerService = blueprint.services.find((s) => s.type === 'worker');

      const webRoleVar = webService?.envVars?.find((v) => v.key === 'PROCESS_ROLE');
      const workerRoleVar = workerService?.envVars?.find((v) => v.key === 'PROCESS_ROLE');

      expect(webRoleVar).toBeDefined();
      expect(webRoleVar?.value).toBe('web');

      expect(workerRoleVar).toBeDefined();
      expect(workerRoleVar?.value).toBe('worker');
    });

    it('declares database and redis environment variables for both services without committed values', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');
      const workerService = blueprint.services.find((s) => s.type === 'worker');

      const requiredKeys = [
        'DATABASE_URL',
        'REDIS_HOST',
        'REDIS_PORT',
        'REDIS_PASSWORD',
        'JWT_SECRET',
        'PUBLIC_APP_URL',
      ];

      for (const key of requiredKeys) {
        const webVar = webService?.envVars?.find((v) => v.key === key);
        const workerVar = workerService?.envVars?.find((v) => v.key === key);

        expect(webVar).toBeDefined();
        expect(workerVar).toBeDefined();

        // Must not commit hardcoded credentials
        if (webVar?.value) {
          expect(webVar.value).not.toMatch(/postgres:\/\/|redis:\/\/|password/i);
        }
      }
    });

    it('generates LOGIN_CODE_SECRET on the web service and shares it with the worker the same way as JWT_SECRET', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');
      const workerService = blueprint.services.find((s) => s.type === 'worker');
      const webVar = webService?.envVars?.find((v) => v.key === 'LOGIN_CODE_SECRET');
      const workerVar = workerService?.envVars?.find((v) => v.key === 'LOGIN_CODE_SECRET');

      expect(webVar).toBeDefined();
      expect(webVar?.generateValue).toBe(true);
      expect(webVar?.value).toBeUndefined();
      expect(workerVar?.fromService).toEqual({
        type: 'web',
        name: 'laboura-api',
        envVarKey: 'LOGIN_CODE_SECRET',
      });

      const deploy = fs.readFileSync(deployMdPath, 'utf8');
      expect(deploy).toContain('LOGIN_CODE_SECRET');
    });

    it('configures PUBLIC_APP_URL without a committed value and shares it with the worker', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');
      const workerService = blueprint.services.find((s) => s.type === 'worker');
      const webVar = webService?.envVars?.find((v) => v.key === 'PUBLIC_APP_URL');
      const workerVar = workerService?.envVars?.find((v) => v.key === 'PUBLIC_APP_URL');

      expect(webVar).toMatchObject({ key: 'PUBLIC_APP_URL', sync: false });
      expect(webVar?.value).toBeUndefined();
      expect(workerVar?.fromService).toEqual({
        type: 'web', name: 'laboura-api', envVarKey: 'PUBLIC_APP_URL',
      });
      expect(fs.readFileSync(deployMdPath, 'utf8')).toMatch(/PUBLIC_APP_URL.*public web address of the app/i);
    });

    it('declares provider modes defaulting to mock (§3)', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');

      const providerModes = [
        'OTP_PROVIDER_MODE',
        'PAYMENT_PROVIDER_MODE',
        'WHATSAPP_PROVIDER_MODE',
        'TELEPHONY_PROVIDER_MODE',
        'KYC_PROVIDER_MODE',
      ];

      for (const mode of providerModes) {
        const envVar = webService?.envVars?.find((v) => v.key === mode);
        expect(envVar).toBeDefined();
        expect(envVar?.value).toBe('mock');
      }
    });

    it('declares sensitive credentials with sync: false, generateValue: true, or fromService (no committed secrets)', () => {
      const sensitiveKeys = [
        'DATABASE_URL',
        'REDIS_PASSWORD',
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
        'WHATSAPP_API_KEY',
        'TELEPHONY_API_KEY',
        'KYC_API_KEY',
        'CALL_ROUTING_KEY',
        'TELEPHONY_WEBHOOK_SECRET',
        'MESSAGE_WEBHOOK_SECRET',
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'RECORDINGS_BUCKET',
      ];

      for (const service of blueprint.services) {
        for (const envVar of service.envVars || []) {
          if (sensitiveKeys.includes(envVar.key)) {
            // Must not have a committed plaintext secret value
            expect(envVar.value).toBeUndefined();
            // Must be marked sync: false, generateValue: true, or fromService
            const isProtected =
              envVar.sync === false ||
              envVar.generateValue === true ||
              envVar.fromService !== undefined;
            expect(isProtected).toBe(true);
          }
        }
      }
    });
  });

  describe('4. Documentation (DEPLOY.md)', () => {
    it('declares company legal name with sync: false allowing runtime configuration without redeploy', () => {
      const webService = blueprint.services.find((s) => s.type === 'web');
      const companyNameVar = webService?.envVars?.find((v) => v.key === 'COMPANY_LEGAL_NAME');
      expect(companyNameVar).toBeDefined();
      expect(companyNameVar?.sync).toBe(false);
      expect(companyNameVar?.value).toBeUndefined();
    });

    it('provides clear dashboard-based instructions without requiring terminal or command line', () => {
      const content = fs.readFileSync(deployMdPath, 'utf8');

      // Mentions the required providers and dashboards
      expect(content).toContain('Render');
      expect(content).toContain('Supabase');
      expect(content).toContain('Upstash');

      // Explains migrations and preDeployCommand
      expect(content).toContain('npx prisma migrate deploy');
      expect(content).toContain('Pre-Deploy');

      // Explains PROCESS_ROLE gating
      expect(content).toContain('PROCESS_ROLE');

      // Explicitly written for non-terminal operators
      expect(content).toContain('No command line or terminal is required');

      // Prominent warning on Cloudflare Access enforcement before real data entry
      expect(content).toContain('CLOUDFLARE_ACCESS_ENFORCED');
      expect(content).toContain('MUST be set to');
      expect(content).toContain('before any real candidate');

      // Phase 11: Call routing key, webhook addresses, and private recordings bucket in Supabase
      expect(content).toContain('CALL_ROUTING_KEY');
      expect(content).toContain('TELEPHONY_WEBHOOK_SECRET');
      expect(content).toContain('MESSAGE_WEBHOOK_SECRET');
      expect(content).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(content).toContain('recordings');
      expect(content).toContain('/telephony/webhook/call-status');
      expect(content).toContain('/messages/webhook/whatsapp');
      expect(content).toContain('/messages/webhook/sms');
    });

    it('verifies docs/calling-vendor-checklist.md documents all technical requirements and vendor comparison', () => {
      const checklistPath = path.join(rootDir, 'docs/calling-vendor-checklist.md');
      expect(fs.existsSync(checklistPath)).toBe(true);
      const checklist = fs.readFileSync(checklistPath, 'utf8');

      // Agent leg as ordinary mobile
      expect(checklist).toContain('Agent Leg');
      expect(checklist).toContain('ordinary mobile number');

      // Customer sees company number only
      expect(checklist).toContain('Customer Leg');
      expect(checklist).toContain('only Laboura');

      // Recording
      expect(checklist).toContain('This call is recorded for quality and service.');

      // CallStatusEvent fields
      expect(checklist).toContain('CallStatusEvent');
      expect(checklist).toContain('providerCallId');
      expect(checklist).toContain('durationSec');
      expect(checklist).toContain('recordingUrl');

      // 140 / 1600 series
      expect(checklist).toContain('140');
      expect(checklist).toContain('1600');

      // Exotel vs Tata choice check
      expect(checklist).toContain('Exotel');
      expect(checklist).toContain('Tata');
    });
  });
});
