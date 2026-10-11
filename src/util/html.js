/**
 * Util HTML kecil — escape teks yang akan disisipkan ke innerHTML.
 * Dipakai untuk nilai yang berasal dari input/scenario (mis. nama fixture).
 */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
