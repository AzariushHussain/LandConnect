import { isListingId as uuid } from '../listings/types';
export { uuid };
export const row = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, max: number) =>
  typeof value === 'string' && !!value.trim() && Array.from(value).length <= max;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const messageId = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
export type Person = { id: string; display_name: string; role: 'buyer' | 'seller' | 'broker' };
export type Conversation = {
  id: string;
  kind: 'direct' | 'group';
  name: string | null;
  owner_id: string | null;
  created_at: string;
  members: { user: Person; role: 'admin' | 'member'; joined_at: string }[];
};
export type Message = {
  id: number;
  conversation_id: string;
  sender: Person;
  client_id: string | null;
  body: string;
  created_at: string;
};
export type MessagePage = {
  items: Message[];
  has_more: boolean;
  next_after_id: number | null;
  next_before_id: number | null;
};
export type HistoryQuery = { after?: number; before?: number };
export function person(value: unknown): Person {
  const data = row(value);
  if (
    typeof data.id !== 'string' ||
    !uuid(data.id) ||
    !text(data.display_name, 80) ||
    !['buyer', 'seller', 'broker'].includes(String(data.role))
  )
    throw new Error('Invalid chat participant. Refresh and try again.');
  return {
    id: data.id,
    display_name: data.display_name as string,
    role: data.role as Person['role'],
  };
}
export function conversation(value: unknown, actor: string): Conversation {
  const data = row(value);
  if (
    typeof data.id !== 'string' ||
    !uuid(data.id) ||
    !['direct', 'group'].includes(String(data.kind)) ||
    !date(data.created_at) ||
    !Array.isArray(data.members) ||
    data.members.length < 1 ||
    data.members.length > 50
  )
    throw new Error('Invalid conversation. Refresh and try again.');
  const members = data.members.map((value) => {
    const member = row(value);
    if (!['admin', 'member'].includes(String(member.role)) || !date(member.joined_at))
      throw new Error('Invalid chat membership.');
    return {
      user: person(member.user),
      role: member.role as 'admin' | 'member',
      joined_at: member.joined_at as string,
    };
  });
  if (
    !members.some((member) => member.user.id === actor) ||
    new Set(members.map((member) => member.user.id)).size !== members.length
  )
    throw new Error('Your chat membership could not be verified.');
  if (
    data.kind === 'direct'
      ? members.length !== 2 || data.name !== null || data.owner_id !== null
      : !text(data.name, 100) ||
        typeof data.owner_id !== 'string' ||
        !members.some((member) => member.user.id === data.owner_id && member.role === 'admin')
  )
    throw new Error('Invalid conversation permissions.');
  return {
    id: data.id,
    kind: data.kind as Conversation['kind'],
    name: data.name as string | null,
    owner_id: data.owner_id as string | null,
    created_at: data.created_at as string,
    members,
  };
}
export function message(value: unknown, conversationId: string): Message {
  const data = row(value);
  if (
    !messageId(data.id) ||
    data.conversation_id !== conversationId ||
    !text(data.body, 4000) ||
    !date(data.created_at) ||
    !(data.client_id === null || (typeof data.client_id === 'string' && uuid(data.client_id)))
  )
    throw new Error('Invalid message history. Refresh this chat.');
  return {
    id: data.id,
    conversation_id: conversationId,
    sender: person(data.sender),
    client_id: data.client_id as string | null,
    body: data.body as string,
    created_at: data.created_at as string,
  };
}
export function history(value: unknown, id: string, query: HistoryQuery): MessagePage {
  const data = row(value);
  if (!Array.isArray(data.items) || data.items.length > 50 || typeof data.has_more !== 'boolean')
    throw new Error('Invalid message page.');
  const items = data.items.map((value) => message(value, id));
  if (
    items.some(
      (item, index) =>
        (index > 0 && item.id <= items[index - 1]!.id) ||
        (query.after !== undefined && item.id <= query.after) ||
        (query.before !== undefined && item.id >= query.before),
    )
  )
    throw new Error('Invalid message order or cursor.');
  const last = items.at(-1)?.id ?? query.after ?? null;
  const before = items.length && data.has_more && query.after === undefined ? items[0]!.id : null;
  if (
    data.next_after_id !== last ||
    data.next_before_id !== before ||
    (data.has_more && items.length === 0)
  )
    throw new Error('Invalid history cursor.');
  return { items, has_more: data.has_more, next_after_id: last, next_before_id: before };
}
export function validateBody(body: string) {
  if (!body.trim() || Array.from(body).length > 4000)
    throw new Error('Write a message of 1 to 4000 characters.');
  return body;
}
export function groupName(name: string) {
  const value = name.trim();
  if (!value || Array.from(value).length > 100)
    throw new Error('Group names need 1 to 100 characters.');
  return value;
}
export function permissions(chat: Conversation, actor: string) {
  const owner = chat.kind === 'group' && chat.owner_id === actor;
  const admin =
    chat.kind === 'group' &&
    (owner || chat.members.some((member) => member.user.id === actor && member.role === 'admin'));
  return {
    owner,
    admin,
    canLeave: chat.kind === 'group' && !owner,
    canRemove: (id: string) =>
      admin &&
      id !== actor &&
      id !== chat.owner_id &&
      (owner || chat.members.some((member) => member.user.id === id && member.role === 'member')),
  };
}
export const title = (chat: Conversation, actor: string) =>
  chat.kind === 'group'
    ? chat.name!
    : (chat.members.find((member) => member.user.id !== actor)?.user.display_name ?? 'Direct chat');
