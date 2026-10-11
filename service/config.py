import math
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Config(BaseSettings):
    """Private settings: explicit values > process environment > optional dotenv > defaults."""

    model_config = SettingsConfigDict(
        env_file='.env', env_file_encoding='utf-8', extra='ignore',
        populate_by_name=True, hide_input_in_errors=True,
    )

    token: str = Field(default='', validation_alias='SENTRA_ADMIN_TOKEN', repr=False)
    exchange: str = Field(default='kraken', validation_alias='SENTRA_EXCHANGE')
    api_key: str = Field(default='', validation_alias='EXCHANGE_API_KEY', repr=False)
    secret: str = Field(default='', validation_alias='EXCHANGE_API_SECRET', repr=False)
    password: str = Field(default='', validation_alias='EXCHANGE_API_PASSPHRASE', repr=False)
    sandbox: bool = Field(default=False, validation_alias='EXCHANGE_SANDBOX')
    live: bool = Field(default=False, validation_alias='ENABLE_LIVE_TRADING')
    max_order: float = Field(default=0, validation_alias='LIVE_MAX_ORDER_USD')
    daily_limit: float = Field(default=0, validation_alias='LIVE_DAILY_BUY_LIMIT_USD')
    twitter_key: str = Field(default='', validation_alias='TWITTER_API_KEY', repr=False)
    typesafe_key: str = Field(default='', validation_alias='TYPESAFE_API_KEY', repr=False)
    rss_url: str = Field(default='', validation_alias='NEWS_RSS_URL')
    rpc_url: str = Field(default='', validation_alias='ETH_RPC_URL', repr=False)
    ntfy_url: str = Field(default='', validation_alias='NTFY_TOPIC_URL', repr=False)
    ntfy_token: str = Field(default='', validation_alias='NTFY_ACCESS_TOKEN', repr=False)
    origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [f'http://{host}:{port}' for port in (5173, 4173, 8000) for host in ('localhost', '127.0.0.1')],
        validation_alias='ALLOWED_ORIGINS',
    )
    db_path: Path = Field(default=Path('runtime/sentra.sqlite3'), validation_alias='SENTRA_DB_PATH')
    poll_seconds: float = 60

    @field_validator('origins', mode='before')
    @classmethod
    def parse_origins(cls, value):
        # Keep the existing comma-separated environment contract.
        return [origin.strip() for origin in value.split(',') if origin.strip()] if isinstance(value, str) else value

    @classmethod
    def from_env(cls, **overrides):
        return cls(**overrides)

    @property
    def live_ready(self):
        return bool(self.live and self.api_key and self.secret and 0 < self.max_order <= self.daily_limit)

    def validate_startup(self):
        if len(self.token) < 32:
            raise RuntimeError('Set SENTRA_ADMIN_TOKEN to a private token of at least 32 characters.')
        if self.exchange not in ('kraken', 'binance', 'coinbase'):
            raise RuntimeError('SENTRA_EXCHANGE must be kraken, binance, or coinbase.')
        if '*' in self.origins:
            raise RuntimeError('List specific ALLOWED_ORIGINS; wildcard origins are not supported.')
        if self.live and (not self.live_ready or not math.isfinite(self.max_order) or not math.isfinite(self.daily_limit)):
            raise RuntimeError('Live trading needs exchange credentials and explicit positive LIVE_MAX_ORDER_USD and LIVE_DAILY_BUY_LIMIT_USD caps.')
