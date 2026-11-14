import * as fs from 'fs';
import * as path from 'path';
import { ConsoleController } from './console.controller';
import { renderSetupPageHtml } from './templates/setup-page.html';
import { PUBLIC_ROUTE_KEY } from '../../common/rbac/public.decorator';

describe('H4: first CEO set-up from the app\'s own address, never through a third-party site', () => {
  const html = renderSetupPageHtml();

  it('GET /setup serves the page as a public shell (the bootstrap request itself needs the secret)', () => {
    const controller = new ConsoleController();
    expect(controller.getSetupPage()).toBe(html);
    const reason = Reflect.getMetadata(PUBLIC_ROUTE_KEY, ConsoleController.prototype.getSetupPage) as string;
    expect(reason).toMatch(/STAFF_BOOTSTRAP_SECRET/);
  });

  it('sends the form to /staff/bootstrap on the same address and loads nothing from elsewhere', () => {
    expect(html).toContain("fetch('/staff/bootstrap'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<img/i);
    expect(html).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(html).toContain('name="referrer" content="no-referrer"');
  });

  it('after creating the CEO, sends them to /login (staff code, password, then the authenticator set-up there), not the retired /admin', () => {
    expect(html).toContain('go to /login and log in with the staff code and the password');
    expect(html).toContain('The authenticator app is set up there');
    expect(html).not.toContain('/admin');
  });

  it('is the only page besides the old admin dashboard the console controller still serves', () => {
    const routes = Object.getOwnPropertyNames(ConsoleController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => Reflect.getMetadata('path', (ConsoleController.prototype as unknown as Record<string, object>)[name]) as string | string[]);
    expect(routes).toEqual(['setup', 'console/admin']);
  });

  it('DEPLOY.md bootstraps from /setup (or the console on the app\'s own origin) and never sends secrets or tokens through reqbin', () => {
    const deploy = fs.readFileSync(path.join(__dirname, '../../../DEPLOY.md'), 'utf8');
    expect(deploy).not.toMatch(/reqbin\.com/i);
    expect(deploy).toContain('/setup');
    expect(deploy).toMatch(/Never type the bootstrap secret, the CEO password or a login token into any other website/);
    // Office networks are added from the Devices & logins screen.
    expect(deploy).toMatch(/Devices & logins/);
  });
});
