import { Conversation, permissions } from './types';

export function participantActions(chat: Conversation, actor: string, target: string) {
  const member = chat.members.find((item) => item.user.id === target);
  if (
    chat.kind !== 'group' ||
    !member ||
    target === actor ||
    !chat.members.some((item) => item.user.id === actor)
  )
    return [];
  const actions: ('message' | 'audio' | 'video' | 'promote' | 'demote' | 'transfer' | 'remove')[] =
    ['message', 'audio', 'video'];
  const access = permissions(chat, actor);
  if (access.owner) actions.push(member.role === 'admin' ? 'demote' : 'promote', 'transfer');
  if (access.canRemove(target)) actions.push('remove');
  return actions;
}
