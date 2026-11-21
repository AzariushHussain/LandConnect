from starlette.requests import HTTPConnection

from app.services.realtime import ChatHub


def get_chat(connection: HTTPConnection) -> ChatHub:
    return connection.app.state.chat
