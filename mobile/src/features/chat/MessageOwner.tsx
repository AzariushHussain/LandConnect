import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { chatApi } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Notice } from '../../ui/components';

export function MessageOwner({ ownerId }: { ownerId: string }) {
  const state = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (state.status !== 'signedIn' || state.user.id === ownerId) return null;
  async function open() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const chat = await chatApi.direct(ownerId);
      if (!mounted.current) return;
      router.push({ pathname: '/chats/[id]', params: { id: chat.id } });
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : 'Could not open this conversation.');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      {!!error && <Notice error>{error}</Notice>}
      <Action label="Message owner" busy={busy} onPress={() => void open()} />
    </>
  );
}
