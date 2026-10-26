import { requireUser } from '@/server/auth';
import { route } from '@/server/http';

export const GET = route((req) => requireUser(req));
