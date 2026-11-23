import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { privacyApi } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Notice } from '../../ui/components';
import { Person } from '../chat/types';

export function BlockButton({ peer }: { peer: Person }) {
  const session = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (session.status !== 'signedIn' || session.user.id === peer.id) return null;
  async function block() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await privacyApi.block(peer.id);
      if (mounted.current)
        Alert.alert(
          'Account blocked',
          `${peer.display_name} is blocked. You can review or undo your blocks in My account > Privacy settings > Blocked accounts.`,
        );
    } catch {
      if (mounted.current)
        setError(
          'Could not confirm blocking. Check Blocked accounts before trying again; the request may have succeeded.',
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      {!!error && <Notice error>{error}</Notice>}
      <Action
        label={`Block ${peer.display_name}`}
        secondary
        busy={busy}
        onPress={() =>
          Alert.alert(
            `Block ${peer.display_name}?`,
            'This prevents direct messaging and new invitations between these accounts and restricts affected call/meeting access. Existing group conversations and history remain shared.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Block account', style: 'destructive', onPress: () => void block() },
            ],
          )
        }
      />
    </>
  );
}
