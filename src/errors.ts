export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

export class InputError extends Error {
  override readonly name = "InputError";
}

export class AuthenticationError extends Error {
  override readonly name = "AuthenticationError";
}

export class RateLimitError extends Error {
  override readonly name = "RateLimitError";
}
