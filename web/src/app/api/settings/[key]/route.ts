import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { parseBody, route } from '@/server/http';
import { setSetting } from '@/server/settings';

const SettingBody = z.object({ value: z.unknown().refine((v) => v !== undefined, 'value is required') });

export const PUT = route<{ key: string }>(async (req, { key }) => {
  await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, SettingBody);
  return setSetting(key, dto.value);
});
