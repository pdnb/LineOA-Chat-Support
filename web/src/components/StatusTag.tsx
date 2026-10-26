import { Tag } from 'antd';
import { CONVERSATION_STATUS, JOB_STATUS, TONE_COLOR, Tone } from '@/lib/format';
import { ConversationStatus, JobStatus } from '@/lib/types';

export function ToneTag({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <Tag color={TONE_COLOR[tone]} style={{ marginInlineEnd: 0 }}>
      {children}
    </Tag>
  );
}

export function JobStatusTag({ status }: { status: JobStatus }) {
  return <ToneTag tone={JOB_STATUS[status].tone}>{JOB_STATUS[status].label}</ToneTag>;
}

export function ConversationStatusTag({ status }: { status: ConversationStatus }) {
  return <ToneTag tone={CONVERSATION_STATUS[status].tone}>{CONVERSATION_STATUS[status].label}</ToneTag>;
}

/** Which LINE OA a chat came in through; its own color so it never reads as a status. */
export function ChannelTag({ children }: { children: React.ReactNode }) {
  return (
    <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
      {children}
    </Tag>
  );
}
