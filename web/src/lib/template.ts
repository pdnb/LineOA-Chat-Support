/** Replace `{key}` placeholders; unknown keys become empty strings. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

/** Fill a canned reply. Unlike fillTemplate, placeholders it doesn't know stay as typed so the agent sees them. */
export function fillCanned(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? (vars[key] ?? '') : whole));
}

/** Placeholders a canned reply may use (filled in the composer). */
export const CANNED_VARIABLES = [
  { key: '{name}', label: 'ชื่อลูกค้า' },
  { key: '{agent}', label: 'ชื่อเจ้าหน้าที่' },
  { key: '{oa}', label: 'ชื่อ LINE OA' },
  { key: '{phone}', label: 'เบอร์โทรลูกค้า' },
];
