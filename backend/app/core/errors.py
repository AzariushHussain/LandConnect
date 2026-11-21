class ChatError(Exception):
    status_code = 400


class ChatNotFound(ChatError):
    status_code = 404


class ChatForbidden(ChatError):
    status_code = 403


class ChatConflict(ChatError):
    status_code = 409


class ChatInvalid(ChatError):
    status_code = 422
