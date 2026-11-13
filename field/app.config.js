/**
 * Laboura Field is built twice for the web (decided 14 Nov):
 *   - field/dist      base /field — Laboura Field at /field on the office
 *                     address and the Render test address (app.json's baseUrl);
 *   - field/dist-root base /      — Laboura Field at the root of its own
 *                     address, field.laboura.com (FIELD_HOST on the server).
 * LABOURA_FIELD_BASE_URL=/ makes the root build; unset keeps app.json.
 */
module.exports = ({ config }) => {
  const base = process.env.LABOURA_FIELD_BASE_URL;
  if (base === undefined) return config;
  const trimmed = base.replace(/^\/+|\/+$/g, '');
  const experiments = { ...(config.experiments || {}) };
  if (trimmed) experiments.baseUrl = `/${trimmed}`;
  else delete experiments.baseUrl;
  return { ...config, experiments };
};
