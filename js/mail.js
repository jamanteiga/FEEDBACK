// Lectura de correos .eml (postal-mime) y .msg de Outlook (msgreader). Funciona en el hilo principal o en un Web Worker.
import { htmlToText } from './extract.js';
const addr = a => a ? (a.name && a.address ? `${a.name} <${a.address}>` : (a.address || a.name || '')) : '';
export async function parseEmail(ext, buf) {
  let r;
  if (ext === 'eml') {
    const e = await new EmailLibs.PostalMime().parse(buf);
    r = { subject: e.subject || '', from: addr(e.from), to: (e.to || []).map(addr).join('; '), cc: (e.cc || []).map(addr).join('; '),
      date: e.date ? new Date(e.date).toISOString() : null, text: e.text || '', html: e.html || '',
      atts: (e.attachments || []).map(a => ({ name: a.filename || 'adjunto', mime: a.mimeType || '', bytes: new Uint8Array(a.content), inline: a.disposition === 'inline' || !!a.related })) };
  } else {
    const m = new EmailLibs.MsgReader(buf), f = m.getFileData();
    const rec = (f.recipients || []).map(x => x.name && x.email && x.name !== x.email ? `${x.name} <${x.email}>` : (x.email || x.name)).filter(Boolean);
    const dt = f.messageDeliveryTime || f.clientSubmitTime || f.creationTime;
    r = { subject: f.subject || '', from: f.senderName && f.senderEmail && f.senderName !== f.senderEmail ? `${f.senderName} <${f.senderEmail}>` : (f.senderEmail || f.senderName || ''),
      to: rec.join('; '), cc: '', date: dt && !isNaN(new Date(dt)) ? new Date(dt).toISOString() : null, text: f.body || '', html: f.bodyHtml || '',
      atts: (f.attachments || []).filter(a => !a.innerMsgContent).map(a => { const x = m.getAttachment(a); return { name: x.fileName || a.fileName || 'adjunto', mime: a.attachMimeTag || '', bytes: x.content, inline: !!(a.attachmentHidden || a.pidContentId) }; }) };
  }
  let method = 'cuerpo en texto plano', body = (r.text || '').trim();
  if (body.length < 5 && r.html) { body = htmlToText(r.html); method = 'cuerpo convertido desde HTML'; }
  r.body = body; r.method = method; delete r.html;
  return r;
}
