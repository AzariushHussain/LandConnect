export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type RequestOptions = {
  body?: unknown;
  token?: string;
  form?: FormData;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
};

export class ApiClient {
  constructor(
    readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.form ? 45_000 : 12_000);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method ?? (options.body === undefined && !options.form ? 'GET' : 'POST'),
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined || options.form
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body:
          options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        // Do not expose raw server responses or submitted values in UI/logs.
        const messages: Record<number, string> = {
          401: 'Your session is invalid or expired. Please sign in again.',
          403: 'Your account cannot perform this action.',
          409: 'This action conflicts with the current data. Refresh and try again.',
          413: 'This photo is too large. Choose a smaller image.',
          422: 'Check your details and try again.',
          429: 'Too many attempts. Please wait and try again.',
        };
        throw new ApiError(
          response.status,
          messages[response.status] ?? 'The service is unavailable. Please try again.',
        );
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error('Could not reach LandConnect. Check your connection and try again.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
