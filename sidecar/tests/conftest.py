"""Pytest config — общие фикстуры для всех тестов."""
import pytest


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"
