import { ApiError } from '../../api/client';
import { Preferences, privacyChanges, PrivacyApi } from './api';

type State = {
  saved: Preferences | null;
  draft: Preferences | null;
  loading: boolean;
  saving: boolean;
  uncertain: boolean;
  error: string;
  notice: string;
};
export class PrivacyPreferences {
  private state: State = {
    saved: null,
    draft: null,
    loading: true,
    saving: false,
    uncertain: false,
    error: '',
    notice: '',
  };
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<PrivacyApi, 'current' | 'save'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: State) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  stop = () => {
    this.generation++;
  };
  dirty = () =>
    !!this.state.saved &&
    !!this.state.draft &&
    Object.keys(privacyChanges(this.state.saved, this.state.draft)).length > 0;
  edit = (key: keyof Preferences, value: boolean) => {
    if (
      this.state.draft &&
      !this.state.loading &&
      !this.state.saving &&
      !this.state.uncertain &&
      ['allow_messages', 'allow_calls'].includes(key) &&
      typeof value === 'boolean'
    )
      this.update({ ...this.state, draft: { ...this.state.draft, [key]: value }, notice: '' });
  };
  refresh = async () => {
    if (this.state.saving) return;
    const generation = ++this.generation;
    this.update({ ...this.state, loading: true, error: '', notice: '' });
    try {
      const flags = await this.api.current();
      if (generation !== this.generation) return;
      this.update({
        ...this.state,
        saved: flags,
        draft: { ...flags },
        loading: false,
        uncertain: false,
      });
    } catch (failure) {
      if (generation === this.generation)
        this.update({
          ...this.state,
          loading: false,
          error: failure instanceof Error ? failure.message : 'Could not refresh settings.',
        });
    }
  };
  save = async () => {
    if (
      this.state.saving ||
      this.state.loading ||
      this.state.uncertain ||
      !this.state.saved ||
      !this.state.draft
    )
      return;
    const changes = privacyChanges(this.state.saved, this.state.draft);
    if (!Object.keys(changes).length) return;
    const generation = ++this.generation;
    this.update({ ...this.state, saving: true, error: '', notice: '' });
    try {
      const flags = await this.api.save(changes);
      if (generation !== this.generation) return;
      this.update({
        ...this.state,
        saved: flags,
        draft: { ...flags },
        saving: false,
        notice: 'Privacy settings saved.',
      });
    } catch (failure) {
      if (generation !== this.generation) return;
      const uncertain = !(failure instanceof ApiError) || failure.status >= 500;
      this.update({
        ...this.state,
        saving: false,
        uncertain,
        error: uncertain
          ? 'Could not confirm your settings. The change may have been saved. Refresh saved settings before making another change.'
          : failure.message,
      });
    }
  };
}
