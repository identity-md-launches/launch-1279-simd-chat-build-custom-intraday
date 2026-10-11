from dataclasses import dataclass
import os
import math
from pathlib import Path


@dataclass
class Config:
    token: str
    exchange: str
    api_key: str
    secret: str
    password: str
    sandbox: bool
    live: bool
    max_order: float
    daily_limit: float
    twitter_key: str
    typesafe_key: str
    rss_url: str
    rpc_url: str
    ntfy_url: str
    ntfy_token: str
    origins: list[str]
    db_path: Path
    poll_seconds: float = 60

    @classmethod
    def from_env(cls):
        return cls(
            token=os.getenv('SENTRA_ADMIN_TOKEN', ''),
            exchange=os.getenv('SENTRA_EXCHANGE', 'kraken'),
            api_key=os.getenv('EXCHANGE_API_KEY', ''),
            secret=os.getenv('EXCHANGE_API_SECRET', ''),
            password=os.getenv('EXCHANGE_API_PASSPHRASE', ''),
            sandbox=os.getenv('EXCHANGE_SANDBOX', 'false').lower() == 'true',
            live=os.getenv('ENABLE_LIVE_TRADING', 'false').lower() == 'true',
            max_order=float(os.getenv('LIVE_MAX_ORDER_USD', '0')),
            daily_limit=float(os.getenv('LIVE_DAILY_BUY_LIMIT_USD', '0')),
            twitter_key=os.getenv('TWITTER_API_KEY', ''),
            typesafe_key=os.getenv('TYPESAFE_API_KEY', ''),
            rss_url=os.getenv('NEWS_RSS_URL', ''),
            rpc_url=os.getenv('ETH_RPC_URL', ''),
            ntfy_url=os.getenv('NTFY_TOPIC_URL', ''),
            ntfy_token=os.getenv('NTFY_ACCESS_TOKEN', ''),
            origins=[x.strip() for x in os.getenv('ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8000,http://127.0.0.1:8000').split(',') if x.strip()],
            db_path=Path(os.getenv('SENTRA_DB_PATH', 'runtime/sentra.sqlite3')),
        )

    @property
    def live_ready(self):
        return bool(self.live and self.api_key and self.secret and 0 < self.max_order <= self.daily_limit)

    def validate(self):
        if len(self.token) < 32:
            raise RuntimeError('Set SENTRA_ADMIN_TOKEN to a private token of at least 32 characters.')
        if self.exchange not in ('kraken', 'binance', 'coinbase'):
            raise RuntimeError('SENTRA_EXCHANGE must be kraken, binance, or coinbase.')
        if '*' in self.origins:
            raise RuntimeError('List specific ALLOWED_ORIGINS; wildcard origins are not supported.')
        if self.live and (not self.live_ready or not math.isfinite(self.max_order) or not math.isfinite(self.daily_limit)):
            raise RuntimeError('Live trading needs exchange credentials and explicit positive LIVE_MAX_ORDER_USD and LIVE_DAILY_BUY_LIMIT_USD caps.')
