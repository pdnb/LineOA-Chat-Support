export type Role = 'ADMIN' | 'AGENT';
export type ConversationStatus = 'BOT' | 'QUEUED' | 'ASSIGNED' | 'RESOLVED';
export type JobStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'IN_PROGRESS' | 'DONE' | 'REJECTED' | 'FAILED';
export type JobPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive?: boolean;
  lastSeenAt?: string | null;
  online?: boolean;
  /** Has signed in with Auth0 (account linked) */
  auth0Linked?: boolean;
  /** Assigned LINE OAs; from /api/auth/me it is null for admins (= every OA) */
  channelIds?: string[] | null;
}

/** A LINE OA as agents see it (/api/line-channels/options) */
export interface LineChannelOption {
  id: string;
  name: string;
  basicId: string | null;
  pictureUrl: string | null;
  isActive?: boolean;
}

/** Admin view: credentials are write-only */
export interface LineChannel extends LineChannelOption {
  botUserId: string | null;
  greeting: string | null;
  handoffText: string | null;
  botEnabled: boolean;
  isActive: boolean;
  hasSecret: boolean;
  tokenHint: string | null;
  webhookUrl: string;
}

export interface Contact {
  id: string;
  channelId: string;
  channel?: LineChannelOption;
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  phone: string | null;
  note: string | null;
  tags: string[];
}

export interface FormField {
  key: string;
  label: string;
  required?: boolean;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  description: string | null;
  form: FormField[];
  integrationId: string | null;
  integration?: { id: string; name: string } | null;
  autoCreateJob: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface Conversation {
  id: string;
  contactId: string;
  contact: Contact;
  channelId: string;
  channel: LineChannelOption;
  status: ConversationStatus;
  assignedToId: string | null;
  assignedTo: { id: string; name: string } | null;
  categoryId: string | null;
  category: Pick<Category, 'id' | 'code' | 'name' | 'form'> | null;
  collected: Record<string, string> | null;
  unreadCount: number;
  lastMessageText: string | null;
  lastMessageAt: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'IN' | 'OUT';
  senderType: 'CUSTOMER' | 'BOT' | 'AGENT' | 'SYSTEM';
  senderUser?: { id: string; name: string } | null;
  type: string;
  text: string | null;
  payload: any;
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface Integration {
  id: string;
  name: string;
  endpointUrl: string;
  secret: string;
  headers: Record<string, string> | null;
  timeoutMs: number;
  isActive: boolean;
  callbackUrl: string;
}

export interface JobEvent {
  id: string;
  status: JobStatus | null;
  note: string | null;
  source: 'SYSTEM' | 'AGENT' | 'INTEGRATION';
  data: unknown;
  createdAt: string;
}

export interface Job {
  id: string;
  number: string;
  contactId: string;
  contact: Contact;
  conversationId: string | null;
  category: { id: string; code: string; name: string } | null;
  integration: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  title: string;
  detail: string | null;
  payload: Record<string, unknown>;
  priority: JobPriority;
  status: JobStatus;
  externalRef: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  events?: JobEvent[];
}
