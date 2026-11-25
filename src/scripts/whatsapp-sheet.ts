import { writeFileSync } from 'fs';
import { join } from 'path';
import { renderWhatsAppSheet, WHATSAPP_SHEET_PATH } from '../modules/message/whatsapp-sheet';

/**
 * `npm run whatsapp:sheet`: writes docs/whatsapp-templates.md, the copy-paste
 * sheet for submitting every WhatsApp template in WhatsApp Manager, from
 * src/modules/message/whatsapp-templates.ts (Master Guide rev 211).
 */
const target = join(__dirname, '..', '..', WHATSAPP_SHEET_PATH);
writeFileSync(target, renderWhatsAppSheet(), 'utf8');
console.log(`Wrote ${WHATSAPP_SHEET_PATH}`);
