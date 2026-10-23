/** Thrown by providers when credentials are no longer valid and the user must reconnect. */
export class AuthExpiredError extends Error {
  constructor(message = 'Sign-in expired. Reconnect this account.') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

/** Thrown when a provider cannot do something through its API at all. */
export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
