import { ApiError } from '../../api/client';
import { active, Call, CallAttempt, CallKind, CallsApi } from './api';

type State = {
  call: Call | null;
  attempt: CallAttempt | null;
  busy: boolean;
  verified: boolean;
  joined: boolean;
  foreground: boolean;
  error: string;
};
type Api = Pick<CallsApi, 'list' | 'detail' | 'create' | 'change'>;
export class CallController {
  private state: State = {
    call: null,
    attempt: null,
    busy: false,
    verified: false,
    joined: false,
    foreground: false,
    error: '',
  };
  private listeners = new Set<() => void>();
  private revision = 0;
  private reading = false;
  private connectCallId: string | null = null;
  private queuedRefresh = false;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(
    private readonly api: Api,
    private readonly actor: () => string | undefined,
    private readonly random: () => string,
    private readonly otherMediaBusy: () => boolean = () => false,
    private readonly prepareMedia: (kind: CallKind) => Promise<void> = async () => {},
  ) {}
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  reset = () => {
    this.queuedRefresh = false;
    this.connectCallId = null;
    this.revision++;
    this.reading = false;
    this.update({
      call: null,
      attempt: null,
      busy: false,
      verified: false,
      joined: false,
      foreground: false,
      error: '',
    });
  };
  foreground = (foreground: boolean) => {
    this.update({ foreground });
    if (foreground) void this.refresh();
    else {
      this.queuedRefresh = false;
      this.connectCallId = null;
      this.update({ joined: false, verified: false });
      if (active(this.state.call)) void this.finish();
    }
  };
  hint = (id?: string, terminal = false) => {
    this.queuedRefresh = true;
    if (terminal && this.state.call?.id === id) {
      this.connectCallId = null;
      this.update({ verified: false, joined: false });
    }
    void this.refresh();
  };
  private flushRefresh() {
    if (this.queuedRefresh && this.state.foreground && !this.state.busy && !this.reading)
      void this.refresh();
  }
  refresh = async () => {
    if (!this.state.foreground || this.state.busy || this.reading || !this.actor()) return;
    this.reading = true;
    this.queuedRefresh = false;
    const revision = this.revision;
    try {
      let call = this.state.call;
      if (active(call)) call = await this.api.detail(call!.id);
      else {
        const [accepted, ringing] = await Promise.all([
          this.api.list('accepted'),
          this.api.list('ringing'),
        ]);
        const candidate = accepted[0] ?? ringing[0];
        if (candidate) call = await this.api.detail(candidate.id);
        else if (call?.media_cleanup_pending) call = await this.api.detail(call.id);
      }
      if (revision !== this.revision || !this.state.foreground) return;
      if (!active(call)) this.connectCallId = null;
      this.update({
        call,
        verified: true,
        joined:
          call?.status === 'accepted' && call.id === this.connectCallId && !this.otherMediaBusy(),
        attempt:
          call?.client_id && call.client_id === this.state.attempt?.client_id
            ? null
            : this.state.attempt,
        error: '',
      });
    } catch (error) {
      if (revision === this.revision) this.connectCallId = null;
      if (revision === this.revision)
        this.update({
          ...(error instanceof ApiError && error.status === 404 ? { call: null } : {}),
          verified: false,
          joined: false,
          error: 'Could not confirm call status. Media is stopped. Refresh to try again.',
        });
    } finally {
      if (revision === this.revision) {
        this.reading = false;
        this.flushRefresh();
      }
    }
  };
  start = async (callee: string, kind: CallKind) => {
    if (this.blockedByMeeting()) return;
    if (this.state.busy || active(this.state.call) || this.state.attempt || !this.state.foreground)
      return;
    this.connectCallId = null;
    this.update({
      call: null,
      verified: false,
      attempt: { client_id: this.random(), callee_id: callee, kind },
      joined: false,
    });
    await this.retry();
  };
  retry = async () => {
    if (this.blockedByMeeting()) return;
    const attempt = this.state.attempt;
    if (!attempt || this.state.busy || !this.state.foreground) return;
    const revision = ++this.revision;
    const actor = this.actor();
    this.reading = false;
    this.update({ busy: true, error: '' });
    let prepared = false;
    try {
      await this.prepareMedia(attempt.kind);
      prepared = true;
      if (revision !== this.revision) return;
      if (!actor || this.actor() !== actor) {
        this.reset();
        return;
      }
      if (!this.state.foreground || this.blockedByMeeting()) {
        this.update({
          attempt: null,
          error: 'Call cancelled before connecting. Try again when you are ready.',
        });
        return;
      }
      const call = await this.api.create(attempt);
      if (revision !== this.revision) return;
      this.connectCallId = this.state.foreground && active(call) ? call.id : null;
      this.update({
        call,
        attempt: null,
        verified: true,
        joined: call.status === 'accepted' && this.state.foreground,
      });
      if (!this.state.foreground && active(call)) {
        this.update({ busy: false });
        await this.finish();
      }
    } catch (error) {
      if (revision === this.revision)
        this.update({
          attempt:
            !prepared ||
            (error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status))
              ? null
              : attempt,
          error: !prepared
            ? 'Microphone/camera access is required. Check app permissions and call again.'
            : error instanceof ApiError
              ? error.message
              : 'Could not confirm the call. Retry the same attempt; it may already exist.',
        });
    } finally {
      if (revision === this.revision) {
        this.update({ busy: false });
        this.flushRefresh();
      }
    }
  };
  accept = async () => {
    if (this.blockedByMeeting()) return;
    const call = this.state.call;
    if (
      !call ||
      call.status !== 'ringing' ||
      call.callee.id !== this.actor() ||
      !this.state.foreground ||
      this.state.busy
    )
      return;
    await this.change('accept');
  };
  join = async () => {
    if (this.blockedByMeeting()) return;
    await this.refresh();
    if (this.blockedByMeeting()) return;
    if (
      this.state.foreground &&
      this.state.verified &&
      !this.state.busy &&
      this.state.call?.status === 'accepted'
    ) {
      this.connectCallId = this.state.call.id;
      this.update({ joined: true });
    }
  };
  mediaFailed = () => {
    this.connectCallId = null;
    this.update({
      joined: false,
      error:
        'Could not connect the call. Check microphone/camera access and your connection, then reconnect.',
    });
  };
  private blockedByMeeting() {
    if (!this.otherMediaBusy()) return false;
    this.update({ error: 'Leave meeting media before starting or accepting a one-to-one call.' });
    return true;
  }
  finish = async () => {
    this.connectCallId = null;
    this.update({ joined: false });
    const call = this.state.call;
    if (!call || !active(call) || this.state.busy) return;
    await this.change(
      call.status === 'accepted' ? 'end' : call.caller.id === this.actor() ? 'cancel' : 'reject',
    );
  };
  private async change(action: 'accept' | 'reject' | 'cancel' | 'end') {
    const call = this.state.call!;
    const actor = this.actor();
    const revision = ++this.revision;
    this.reading = false;
    this.update({ busy: true, verified: false, error: '' });
    try {
      if (action === 'accept') {
        await this.prepareMedia(call.kind);
        if (revision !== this.revision) return;
        if (!actor || this.actor() !== actor) {
          this.reset();
          return;
        }
        if (!this.state.foreground || this.blockedByMeeting()) {
          this.update({
            error: 'Answer cancelled before connecting. You can answer again or decline.',
          });
          return;
        }
      }
      let result: Call;
      try {
        result = await this.api.change(call.id, action);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 409)) throw error;
        result = await this.api.detail(call.id);
        if (action !== 'accept' && result.status === 'accepted')
          result = await this.api.change(call.id, 'end');
      }
      if (revision !== this.revision) return;
      this.connectCallId =
        action === 'accept' && result.status === 'accepted' && this.state.foreground
          ? result.id
          : null;
      this.update({ call: result, verified: true, joined: this.connectCallId === result.id });
      if (!this.state.foreground && active(result)) {
        this.update({ busy: false });
        await this.finish();
      }
    } catch {
      if (revision === this.revision) this.connectCallId = null;
      if (revision === this.revision)
        this.update({
          verified: false,
          joined: false,
          error:
            'Could not confirm this action. Media is stopped. Refresh and retry the call action.',
        });
    } finally {
      if (revision === this.revision) {
        this.update({ busy: false });
        this.flushRefresh();
      }
    }
  }
}
