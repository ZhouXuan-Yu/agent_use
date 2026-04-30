import pytest
import server


@pytest.fixture(scope="session", autouse=True)
def ensure_test_images():
    """ORB demos need JPEG fixtures; idempotent if files already exist."""
    server.generate_test_images()


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"
