import type { PrivacyApi } from './api';

export const emptyContactBlock = {
  blocked: null as boolean | null,
  loading: false,
  busy: false,
  uncertain: false,
  error: '',
  notice: '',
};
export class ContactBlock {
  private state = { ...emptyContactBlock };
  private generation = 0;
  private live = true;
  private listeners = new Set<() => void>();
  constructor(
    readonly target: string,
    private readonly api: Pick<PrivacyApi, 'blocked' | 'block' | 'unblock'>,
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
    this.listeners.forEach((listener) => listener());
  }
  stop = () => {
    this.live = false;
    this.generation++;
  };
  refresh = async () => {
    if (this.state.busy || (this.state.loading && this.live)) return;
    this.live = true;
    const generation = ++this.generation;
    this.update({ loading: true, error: '' });
    try {
      const blocked = await this.api.blocked(this.target);
      if (this.live && generation === this.generation)
        this.update({
          blocked,
          loading: false,
          uncertain: false,
          notice: blocked === this.state.blocked ? this.state.notice : '',
        });
    } catch (failure) {
      if (this.live && generation === this.generation)
        this.update({
          loading: false,
          error:
            failure instanceof Error
              ? failure.message
              : 'Could not verify contact privacy. Please refresh.',
        });
    }
  };
  change = async (blocked: boolean) => {
    if (
      !this.live ||
      this.state.busy ||
      this.state.loading ||
      this.state.uncertain ||
      this.state.blocked === null ||
      this.state.blocked === blocked
    )
      return;
    const generation = ++this.generation;
    this.update({ busy: true, error: '', notice: '' });
    try {
      if (blocked) await this.api.block(this.target);
      else await this.api.unblock(this.target);
      if (this.live && generation === this.generation)
        this.update({
          blocked,
          busy: false,
          notice: blocked
            ? 'Contact blocked. Shared groups and existing history remain visible.'
            : 'Contact unblocked. Other privacy settings and blocks still apply.',
        });
    } catch (failure) {
      if (this.live && generation === this.generation)
        this.update({
          busy: false,
          uncertain: true,
          error: `${failure instanceof Error ? failure.message : 'Could not confirm this change.'} Refresh contact privacy before trying again.`,
        });
    }
  };
}
