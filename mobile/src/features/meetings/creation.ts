import { ApiError } from '../../api/client';
import { CallKind } from '../calls/api';
import { MeetingAttempt, MeetingsApi, meetingTitle } from './api';

export class MeetingCreation {
  private state = { attempt: null as MeetingAttempt | null, busy: false, error: '' };
  private listeners = new Set<() => void>();
  constructor(
    private readonly api: Pick<MeetingsApi, 'create'>,
    private readonly random: () => string,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async submit(title: string, kind: CallKind, members: string[]) {
    if (this.state.busy) return null;
    this.update({ busy: true, error: '' });
    try {
      const attempt = this.state.attempt ?? {
        client_id: this.random(),
        title: meetingTitle(title),
        kind,
        member_ids: [...members],
      };
      this.update({ attempt });
      const meeting = await this.api.create(attempt);
      this.update({ attempt: null });
      return meeting;
    } catch (error) {
      this.update({
        error:
          error instanceof Error
            ? error.message
            : 'Could not confirm creation. Retry the same attempt.',
        ...(error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)
          ? { attempt: null }
          : {}),
      });
      return null;
    } finally {
      this.update({ busy: false });
    }
  }
}
