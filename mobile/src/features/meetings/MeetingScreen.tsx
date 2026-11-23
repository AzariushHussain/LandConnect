import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { Redirect, router, useFocusEffect, useIsFocused, usePreventRemove } from 'expo-router';
import { meetingSession, meetingsApi } from '../../application/services';
import { Action, Heading, Notice, Screen } from '../../ui/components';
import { RealtimeNotice } from '../chat/use-chat-updates';
import { PeoplePicker } from '../chat/PeoplePicker';
import { NativeMedia } from '../media/NativeMedia';
import { currentMembers, memberStatus, Meeting } from './api';
import { useMeeting } from './use-meetings';

function MeetingMedia({ meeting }: { meeting: Meeting }) {
  const token = useCallback(
    () => meetingsApi.token(meeting.id, meeting.room_version),
    [meeting.id, meeting.room_version],
  );
  return (
    <NativeMedia
      id={`${meeting.id}:${meeting.room_version}`}
      kind={meeting.kind}
      loadToken={token}
      failed={meetingSession.mediaFailed}
      names={Object.fromEntries(
        currentMembers(meeting).map((m) => [m.user.id, m.user.display_name]),
      )}
    />
  );
}
export function MeetingScreen({ id, actor }: { id: string; actor: string }) {
  const focused = useIsFocused();
  const state = useMeeting(),
    [inviting, setInviting] = useState(false);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  useFocusEffect(
    useCallback(() => {
      void meetingSession.select(id);
    }, [id]),
  );
  useEffect(
    () => () => {
      if (!meetingSession.getSnapshot().meeting?.conversation_id) meetingSession.detach(id);
    },
    [id],
  );
  useEffect(() => {
    if (leave) leave();
  }, [leave]);
  const selected = state.id === id;
  usePreventRemove(
    !leave && selected && (state.busy || state.joining || state.joined),
    ({ repeat }) => {
      if (state.busy || state.joining) {
        Alert.alert('Please wait', 'Wait for the current meeting request to finish.');
        return;
      }
      Alert.alert(
        'Leave meeting media?',
        'Your invitation stays accepted. You can join again while the meeting is open.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave media',
            onPress: () => {
              void meetingSession.change('leave').then((saved) => {
                if (saved) setLeave(() => repeat);
              });
            },
          },
        ],
      );
    },
  );
  if (!selected)
    return (
      <Screen>
        <Notice>
          {state.joined || state.joining || state.busy
            ? 'Finish the current meeting request or leave its media before opening another meeting.'
            : 'Loading meeting...'}
        </Notice>
        {state.id && (
          <Action
            label="Open current meeting"
            onPress={() =>
              router.navigate({ pathname: '/meetings/[id]', params: { id: state.id! } })
            }
          />
        )}
        <Action
          label="Retry opening meeting"
          secondary
          onPress={() => void meetingSession.select(id)}
        />
      </Screen>
    );
  const meeting = state.meeting;
  if (meeting?.conversation_id)
    return <Redirect href={{ pathname: '/group-calls/[id]', params: { id: meeting.id } }} />;
  const owner = meeting?.owner.id === actor;
  const status = meeting ? memberStatus(meeting, actor) : undefined;
  const busy = state.busy || state.joining;
  const open = !!meeting && !meeting.ended_at;
  return (
    <Screen>
      <Heading
        title={meeting?.title ?? 'Meeting'}
        detail={
          meeting
            ? `${meeting.kind} - Host: ${meeting.owner.display_name} - ${meeting.ended_at ? 'Ended' : status}`
            : state.loading
              ? 'Loading meeting...'
              : 'This meeting may be unavailable or your invitation was withdrawn.'
        }
      />
      <RealtimeNotice />
      {!!state.error && <Notice error>{state.error}</Notice>}
      {!!state.notice && <Notice>{state.notice}</Notice>}
      {!!meeting?.media_cleanup_pending && (
        <Notice>
          Media cleanup is pending. Wait and refresh before joining; the server retries cleanup.
        </Notice>
      )}
      {open && (
        <>
          <Notice>
            Keep the app open during media. Leaving media keeps consent; withdrawing consent removes
            your access. The host can end the meeting for everyone.
          </Notice>
          {status === 'invited' && (
            <>
              <Action
                label="Accept meeting invitation"
                busy={busy}
                disabled={!state.verified || !state.foreground}
                onPress={() => void meetingSession.change('accept')}
              />
              <Action
                label="Decline invitation"
                secondary
                busy={busy}
                onPress={() => void meetingSession.change('decline')}
              />
            </>
          )}
          {status === 'accepted' && (
            <>
              {focused && state.joined && state.verified && state.foreground ? (
                <MeetingMedia key={`${meeting!.id}:${meeting!.room_version}`} meeting={meeting!} />
              ) : (
                <>
                  <Notice>
                    Join requests your microphone{meeting!.kind === 'video' ? ' and camera' : ''}.
                    Room changes and failed verification stop media until you explicitly rejoin.
                  </Notice>
                  <Action
                    label="Join meeting media"
                    busy={busy}
                    disabled={!state.foreground || !!meeting!.media_cleanup_pending}
                    onPress={() => void meetingSession.join()}
                  />
                  <Action
                    label="Open app permission settings"
                    secondary
                    onPress={() => {
                      void Linking.openSettings().catch(() =>
                        Alert.alert(
                          'Settings unavailable',
                          'Open LandConnect permissions in your device settings.',
                        ),
                      );
                    }}
                  />
                </>
              )}
              <Action
                label="Leave meeting media"
                secondary
                busy={busy}
                onPress={() => void meetingSession.change('leave')}
              />
              {!owner && (
                <Action
                  label="Withdraw meeting consent"
                  secondary
                  busy={busy}
                  onPress={() =>
                    Alert.alert(
                      'Withdraw consent?',
                      'You lose meeting access until the host invites you again. If you had room access, everyone may need to rejoin a new room.',
                      [
                        { text: 'Keep invitation', style: 'cancel' },
                        {
                          text: 'Withdraw',
                          style: 'destructive',
                          onPress: () => void meetingSession.change('decline'),
                        },
                      ],
                    )
                  }
                />
              )}
            </>
          )}
          {owner && (
            <>
              <Action
                label="Invite another person"
                secondary
                disabled={busy || !state.verified || currentMembers(meeting!).length >= 50}
                onPress={() => setInviting(true)}
              />
              <Action
                label="End meeting for everyone"
                busy={busy}
                onPress={() =>
                  Alert.alert(
                    'End this meeting?',
                    'Everyone will be disconnected and the meeting cannot be reopened.',
                    [
                      { text: 'Keep meeting', style: 'cancel' },
                      {
                        text: 'End meeting',
                        style: 'destructive',
                        onPress: () => void meetingSession.change('end'),
                      },
                    ],
                  )
                }
              />
            </>
          )}
        </>
      )}
      {meeting && (
        <>
          <Heading
            title="Invitations and consent"
            detail="These statuses describe meeting access. Connected media participants appear in the media controls."
          />
          {currentMembers(meeting).map((member) => (
            <Notice key={member.user.id}>
              {member.user.display_name} - {member.status}
              {member.user.id === meeting.owner.id ? ' - host' : ''}
            </Notice>
          ))}
          {open &&
            owner &&
            currentMembers(meeting)
              .filter((member) => member.user.id !== actor)
              .map((member) => (
                <Action
                  key={member.user.id}
                  label={`Remove ${member.user.display_name}`}
                  secondary
                  disabled={busy || !state.verified}
                  onPress={() =>
                    Alert.alert(
                      'Remove this person?',
                      'Access is revoked. A person with an issued token may require a room change; remaining members must rejoin.',
                      [
                        { text: 'Keep member', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => void meetingSession.change('remove', member.user.id),
                        },
                      ],
                    )
                  }
                />
              ))}
          {inviting && open && owner && (
            <PeoplePicker
              actor={actor}
              excluded={currentMembers(meeting).map((m) => m.user.id)}
              selected={[]}
              max={1}
              onCancel={() => setInviting(false)}
              onDone={(people) => {
                setInviting(false);
                if (people[0]) void meetingSession.change('invite', people[0].id);
              }}
            />
          )}
        </>
      )}
      <Action
        label="Refresh meeting"
        secondary
        disabled={busy || !state.foreground}
        onPress={() => void meetingSession.refresh()}
      />
    </Screen>
  );
}
