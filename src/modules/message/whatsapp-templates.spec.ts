import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  WHATSAPP_TEMPLATES,
  WhatsAppTemplateDef,
  metaParameterName,
  sampleValue,
  whatsappTemplate,
} from './whatsapp-templates';
import { metaBody, renderWhatsAppSheet, WHATSAPP_SHEET_PATH } from './whatsapp-sheet';
import { APPROVED_TEMPLATES } from '../../common/whatsapp/real-whatsapp.provider';

const DEFS = Object.values(WHATSAPP_TEMPLATES as Record<string, WhatsAppTemplateDef>);
const VARIABLE = /\{\{(\w+)\}\}/g;

/** Meta's checks for one template text (Master Guide rev 211). Empty when it passes. */
export function templateProblems(def: WhatsAppTemplateDef): string[] {
  const problems: string[] = [];
  const text = def.text;
  const used = [...text.matchAll(VARIABLE)].map((m) => m[1]);
  if (text.length > 1024) problems.push('longer than 1024 characters');
  if (text !== text.trim()) problems.push('leading or trailing spaces');
  // Authentication bodies are written by Meta itself ("{{1}} is your verification code…").
  if (def.category !== 'authentication') {
    if (/^\s*\{\{\w+\}\}/.test(text)) problems.push('starts with a variable');
    // A full stop, comma or bracket after the last variable still counts as ending with it.
    if (/\{\{\w+\}\}[\s.,!?;:)\]'"]*$/.test(text)) problems.push('ends with a variable');
  }
  for (const key of used) {
    const meta = metaParameterName(key);
    if (!/^[a-z][a-z0-9_]*$/.test(meta)) problems.push(`variable ${key} is not lowercase_underscore as ${meta}`);
  }
  const metaNames = used.map(metaParameterName);
  if (new Set(metaNames).size !== metaNames.length) problems.push('a variable is used twice');
  // At least 3 words for every variable, plus one (variables count as words).
  const words = text.split(/\s+/).filter(Boolean).length;
  if (used.length > 0 && words < used.length * 3 + 1) problems.push(`too many variables for its length (${used.length} in ${words} words)`);
  if (JSON.stringify(used) !== JSON.stringify([...def.variables])) problems.push(`variables must list exactly ${used.join(', ') || 'none'}, in text order`);
  return problems;
}

/** Every template name the code sends: template / templateName values and *_TEMPLATE constants in src/. */
function templateNamesUsedInCode(): Set<string> {
  const root = join(__dirname, '..', '..');
  const skip = [
    join('modules', 'message', 'whatsapp-templates.ts'),
    join('modules', 'customer-notification'),
    join('modules', 'legal'),
    'test-support',
  ];
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const rel = path.slice(root.length + 1);
      if (skip.some((s) => rel.startsWith(s))) continue;
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) continue;
      const source = readFileSync(path, 'utf8');
      const patterns = [
        /\b(?:template|templateName)\s*[:=]\s*([^,;}\n]+)/g,
        /\b[A-Z_]*TEMPLATE\s*=\s*([^;\n]+)/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          for (const literal of match[1].matchAll(/['"`]([a-z]+(?:_[a-z0-9]+)+)['"`]/g)) names.add(literal[1]);
        }
      }
    }
  };
  walk(root);
  return names;
}

describe('WhatsApp templates follow Meta\'s rules (rev 211)', () => {
  it('turns camelCase keys into lowercase_underscore parameter names', () => {
    expect(metaParameterName('firstName')).toBe('first_name');
    expect(metaParameterName('newLast4')).toBe('new_last4');
    expect(metaParameterName('link')).toBe('link');
    expect(metaParameterName('candidateFirstName')).toBe('candidate_first_name');
    expect(metaParameterName('upiURL')).toBe('upi_url');
  });

  it('the checker itself catches every broken rule', () => {
    const base = { name: 'x', label: 'x', variables: [] as string[] };
    expect(templateProblems({ ...base, text: '{{firstName}}, hello there from Laboura today.', variables: ['firstName'] })).toContain('starts with a variable');
    expect(templateProblems({ ...base, text: 'Open your Laboura link here now please: {{link}}', variables: ['link'] })).toContain('ends with a variable');
    expect(templateProblems({ ...base, text: 'Open your Laboura link here now please: {{link}}.', variables: ['link'] })).toContain('ends with a variable');
    expect(templateProblems({ ...base, text: 'Hi {{a}} {{b}} {{c}} thanks.', variables: ['a', 'b', 'c'] }).join()).toContain('too many variables');
    expect(templateProblems({ ...base, text: `Hi ${'x'.repeat(1030)} thanks.` })).toContain('longer than 1024 characters');
    expect(templateProblems({ ...base, text: 'Hi {{name}} and {{name}} again, from all of us at Laboura today.', variables: ['name', 'name'] })).toContain('a variable is used twice');
    expect(templateProblems({ ...base, text: 'Hi {{firstName}}, welcome to Laboura, we are glad.', variables: ['first'] }).join()).toContain('variables must list');
  });

  it.each(DEFS.map((d) => [d.name, d] as const))('%s obeys every rule', (_name, def) => {
    expect(templateProblems(def)).toEqual([]);
    expect(def.name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('every name is its own key, every template can be sent, and codes use an Authentication template', () => {
    for (const [key, def] of Object.entries(WHATSAPP_TEMPLATES)) {
      expect(def.name).toBe(key);
      expect(APPROVED_TEMPLATES).toContain(key);
    }
    expect(whatsappTemplate('verification_code')?.category).toBe('authentication');
    expect(DEFS.filter((d) => d.category === 'authentication').map((d) => d.name)).toEqual(['verification_code']);
  });

  it('every template name the code sends has an approved text', () => {
    const used = templateNamesUsedInCode();
    // The scan really finds the senders (guards against a scan that silently finds nothing).
    for (const name of ['interview_offer', 'call_attempt_notice', 'payment_receipt', 'phone_number_changed', 'attendance_leave_decision', 'payment_stuck', 'consent_link']) {
      expect(used).toContain(name);
    }
    // free_text is a free-form reply inside the 24-hour window (FREE_TEXT_TEMPLATE), not a template.
    const missing = [...used].filter((name) => name !== 'free_text' && !whatsappTemplate(name));
    expect(missing).toEqual([]);
  });

  it('every variable has a sample value for the sheet', () => {
    for (const def of DEFS) {
      for (const key of def.variables) expect({ template: def.name, key, sample: sampleValue(def, key) !== key }).toEqual({ template: def.name, key, sample: true });
    }
  });
});

describe('WhatsApp submission sheet (docs/whatsapp-templates.md)', () => {
  it('lists every template with category, language en, a snake_case body and samples', () => {
    const sheet = renderWhatsAppSheet();
    for (const def of DEFS) {
      expect(sheet).toContain(`## ${def.name}\n`);
      expect(sheet).toContain(metaBody(def));
      expect(metaBody(def)).not.toMatch(/\{\{\w*[A-Z]\w*\}\}/);
    }
    expect(sheet).toContain('`verification_code` | Authentication | en |');
    expect(sheet).toContain('`registration_done` | Utility | en |');
    expect(sheet).toContain('| `{{first_name}}` | Ravi |');
  });

  it('is up to date (run `npm run whatsapp:sheet` after changing a template)', () => {
    const onDisk = readFileSync(join(__dirname, '..', '..', '..', WHATSAPP_SHEET_PATH), 'utf8');
    expect(onDisk).toBe(renderWhatsAppSheet());
  });
});
