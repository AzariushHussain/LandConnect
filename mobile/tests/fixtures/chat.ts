import { Conversation, Message, MessagePage, Person } from '../../src/features/chat/types';
import { listingId } from './listings';
export const actor = listingId(900),
  other = listingId(901),
  third = listingId(902),
  chatId = listingId(903);
export const person = (id = actor): Person => ({
  id,
  display_name: id === actor ? 'Buyer' : 'Seller',
  role: id === actor ? 'buyer' : 'seller',
});
export function conversation(group = false): Conversation {
  return {
    id: chatId,
    kind: group ? 'group' : 'direct',
    name: group ? 'Land group' : null,
    owner_id: group ? actor : null,
    created_at: '2026-11-23T00:00:00Z',
    members: [actor, other].map((id) => ({
      user: person(id),
      role: group && id === actor ? 'admin' : 'member',
      joined_at: '2026-11-23T00:00:00Z',
    })),
  };
}
export const message = (
  id: number,
  sender = other,
  clientId: string | null = null,
  body = `Message ${id}`,
): Message => ({
  id,
  conversation_id: chatId,
  client_id: clientId,
  sender: person(sender),
  body,
  created_at: '2026-11-23T00:00:00Z',
});
export const page = (items: Message[], more = false, after?: number): MessagePage => ({
  items,
  has_more: more,
  next_after_id: items.at(-1)?.id ?? after ?? null,
  next_before_id: more && after === undefined ? (items[0]?.id ?? null) : null,
});
