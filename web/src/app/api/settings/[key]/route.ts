import { z } from 'zod';
import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { parseBody, route } from '@/server/http';
import { setSetting } from '@/server/settings';

const SettingBody = z.object({ value: z.unknown().refine((v) => v !== undefined, 'value is required') });

export const PUT = route<{ key: string }>(async (req, { key }) => {
  const user = await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, SettingBody);
  const value = await setSetting(key, dto.value);
  await audit(user, 'setting.update', { type: 'setting', id: key }, { value });
  return value;
});
