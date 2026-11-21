import subprocess
import sys
import textwrap
from pathlib import Path


def test_model_package_registers_all_tables_without_runtime_settings():
    script = textwrap.dedent("""
        import sys
        from sqlalchemy.orm import configure_mappers
        from app.models import Base, Listing, ListingImage, Meeting, MeetingMember, User

        configure_mappers()
        assert set(Base.metadata.tables) == {
            'users', 'blocks', 'listings', 'listing_images', 'conversations',
            'messages', 'calls', 'meetings', 'meeting_members',
        }
        assert Listing.owner.property.mapper.class_ is User
        assert Listing.images.property.mapper.class_ is ListingImage
        assert Meeting.members.property.mapper.class_ is MeetingMember
        assert 'app.core.config' not in sys.modules
        assert 'app.db.session' not in sys.modules
    """)
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
