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
    });
  });
});
