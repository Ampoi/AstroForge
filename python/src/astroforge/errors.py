"""Failures that callers can handle without parsing network error strings."""


class AstroForgeError(Exception):
    """Base SDK error."""


class ConnectionError(AstroForgeError):
    """UDP socket could not be opened or used."""


class ClientClosed(AstroForgeError):
    """Operation on a closed client."""


class TelemetryTimeout(AstroForgeError, TimeoutError):
    """Required observations did not arrive in time."""


class SessionChanged(AstroForgeError):
    """The target session changed; explicitly acquire control again."""


class ControlLost(AstroForgeError):
    """Control expired, was preempted, or the vehicle became unavailable."""


class AuthorityTimeout(AstroForgeError, TimeoutError):
    """Acquisition was not confirmed. No commands may be sent."""
