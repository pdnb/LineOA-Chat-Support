export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…';
}

/** Replace `{key}` placeholders; unknown keys become empty strings. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}
