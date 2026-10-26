'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { LineChannelOption } from './types';

/** The LINE OAs the signed-in user may see. `multi` is false when OA labels would only add noise. */
export function useLineChannels() {
  const query = useQuery({
    queryKey: ['line-channel-options'],
    queryFn: () => api<LineChannelOption[]>('/api/line-channels/options'),
    staleTime: 60_000,
  });
  return { channels: query.data ?? [], multi: (query.data?.length ?? 0) > 1 };
}
