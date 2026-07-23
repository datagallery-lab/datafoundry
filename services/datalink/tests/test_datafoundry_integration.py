import asyncio
import json

from datalink.api.server import healthz
from datalink.config import DataLinkConfig


def test_datafoundry_environment_overrides_config(monkeypatch, tmp_path):
    config_path = tmp_path / "datalink.json"
    config_path.write_text(json.dumps({"llm": {"model": "file-model"}, "graph_db_path": "file.db"}))
    graph_path = tmp_path / "storage" / "datalink.db"

    monkeypatch.setenv("DATALINK_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("DATALINK_GRAPH_DB_PATH", str(graph_path))
    monkeypatch.setenv("DATALINK_LLM_MODEL", "managed-model")
    monkeypatch.setenv("DATALINK_LLM_API_KEY", "managed-key")
    monkeypatch.setenv("DATALINK_EMBEDDING_MODEL", "managed-embedding")

    config = DataLinkConfig.load()

    assert config.graph_db_path == str(graph_path)
    assert config.llm.model == "managed-model"
    assert config.llm.api_key == "managed-key"
    assert config.embedding.model == "managed-embedding"


def test_datafoundry_model_environment_is_fallback(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "datafoundry-model")
    monkeypatch.setenv("LLM_BASE_URL", "https://model.example/v1")
    monkeypatch.setenv("LLM_API_KEY", "datafoundry-key")

    config = DataLinkConfig.load("/does/not/exist.json")

    assert config.llm.model == "datafoundry-model"
    assert config.llm.base_url == "https://model.example/v1"
    assert config.llm.api_key == "datafoundry-key"


def test_healthz_does_not_require_graph_configuration():
    response = asyncio.run(healthz())

    assert response.status_code == 200
    assert json.loads(response.body) == {"status": "ok", "service": "datalink"}
