import json

from sqlalchemy import select

from app.models import ChatOutbox
from app.models.common import now


def flush_outbox(session_factory, publisher, prefix: str) -> int:
    # shortcut: published rows are retained; add a retention job for sustained deployments.
    with session_factory() as db, db.begin():
        rows = db.scalars(
            select(ChatOutbox)
            .where(ChatOutbox.published_at.is_(None))
            .order_by(ChatOutbox.created_at, ChatOutbox.id)
            .limit(20)
            .with_for_update(skip_locked=True)
        ).all()
        if not rows:
            return 0
        pipeline = publisher.pipeline(transaction=False)
        for row in rows:
            payload = json.dumps(row.event, separators=(",", ":"))
            for recipient in row.recipient_ids:
                pipeline.publish(f"{prefix}:user:{recipient}", payload)
        pipeline.execute()
        for row in rows:
            row.published_at = now()
        # A crash after publication can retry events; clients deduplicate their event_id.
        return len(rows)
