import { renderMapPageHtml } from './templates/map.html';
import { ConsoleController } from './console.controller';
import { renderAdminDashboardHtml } from './templates/admin-dashboard.html';
import { renderCallAgentConsoleHtml } from './templates/call-agent-console.html';
import { renderFieldAgentAppHtml } from './templates/field-agent-app.html';

describe('Map page', () => {
  it('uses pinned Leaflet and OpenStreetMap tiles and opens selected records', () => {
    const html = renderMapPageHtml();
    expect(html).toContain('leaflet@1.9.4/dist/leaflet.js');
    expect(html).toContain('leaflet@1.9.4/dist/leaflet.css');
    expect(html).toContain('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(html).toContain("api('/businesses/' + encodeURIComponent(point.id))");
    expect(html).toContain("api('/vacancies/' + encodeURIComponent(id) + '/shortlist')");
    expect(html).toContain('sessionStorage.getItem(\'laboura_token\')');
  });

  it('does not include job seeker coordinates or a business phone in map page code', () => {
    const html = renderMapPageHtml();
    expect(html).not.toMatch(/jobSeekerId|phone|latitude.*candidate/i);
    expect(html).not.toContain('google.com/maps');
  });

  it('serves the map page from the console controller', () => {
    expect(new ConsoleController().getMap()).toContain('<div id="map"');
  });

  it('links to the map from all staff consoles', () => {
    for (const html of [renderAdminDashboardHtml(), renderCallAgentConsoleHtml(), renderFieldAgentAppHtml()]) {
      expect(html).toContain('href="/map"');
    }
  });
});
