import asyncio
from dataclasses import replace
import secrets
import time
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from service.config import Config
from service.main import create_app, Desk, Automation
from service.database import Database
from service.providers import aggregate, polarity


class FakeExchange:
    """Offline test double. No exchange credentials or network requests are used."""
    def __init__(self, options=None):
        self.orders = []
        self.fail_order = False
    async def load_markets(self):
        return {}
    def market(self, symbol):
        return {'spot': True, 'active': True, 'limits': {'cost': {'min': 10}, 'amount': {'min': .0001}}}
    def amount_to_precision(self, symbol, amount):
        return str(int(amount * 1e8) / 1e8)
    async def fetch_ticker(self, symbol):
        return {'last': 100, 'percentage': 1.2, 'quoteVolume': 1000000}
    async def fetch_ohlcv(self, symbol, timeframe, limit):
        end = int(time.time() // 900) * 900000
        return [[end - (180 - i) * 900000, 100, 101, 99, 100, 1000] for i in range(180)]
    async def fetch_balance(self):
        return {'free': {'USDT': 100000, 'BTC': 10, 'ETH': 10, 'SOL': 10}}
    async def create_order(self, symbol, order_type, side, amount, price):
        self.orders.append((symbol, side, amount, price))
        if self.fail_order:
            raise TimeoutError('Simulated uncertain network response')
        return {'id': str(len(self.orders)), 'symbol': symbol, 'side': side, 'status': 'closed', 'filled': amount, 'remaining': 0, 'average': price, 'cost': amount * price}
    async def close(self):
        pass


@pytest.fixture
def config(tmp_path):
    return Config(token=secrets.token_urlsafe(32), exchange='kraken', api_key='', secret='', password='', sandbox=False, live=False,
        max_order=100, daily_limit=200, twitter_key='', typesafe_key='', rss_url='', rpc_url='', ntfy_url='', ntfy_token='',
        origins=['http://localhost:5173'], db_path=tmp_path/'desk.sqlite3', poll_seconds=60)


@pytest.fixture
def live_config(config, monkeypatch):
    # Replace readiness only inside offline tests; no stand-in credentials are delivered.
    monkeypatch.setattr(Config, 'live_ready', property(lambda self: self.live))
    return replace(config, live=True)


def auth(config):
    return {'Authorization': 'Bearer ' + config.token}


def order(notional=50, request_id=None, **overrides):
    return {'asset': 'BTC', 'side': 'buy', 'notional': notional, 'requestId': str(request_id or uuid4()), **overrides}


def test_authentication_and_no_secret_in_health(config):
    with TestClient(create_app(config, FakeExchange)) as client:
        assert client.get('/api/health').status_code == 401
        response = client.get('/api/health', headers=auth(config))
        assert response.status_code == 200
        assert response.json()['liveTrading'] is False
        assert config.token not in response.text


def test_snapshot_omits_missing_sources_and_unobserved_history(config):
    with TestClient(create_app(config, FakeExchange)) as client:
        response = client.get('/api/snapshot?asset=BTC&interval=15', headers=auth(config))
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['sources'] == []
        assert result['price'] == 100
        assert all(c['sentiment'] is None for c in result['candles'])
        assert len(result['candles']) >= 30
        assert client.get('/api/snapshot?asset=BTC&interval=7', headers=auth(config)).status_code == 422
        assert client.get('/api/snapshot?asset=DOGE', headers=auth(config)).status_code == 422


def test_live_order_requires_server_opt_in(config):
    with TestClient(create_app(config, FakeExchange)) as client:
        assert client.post('/api/order', json=order(), headers=auth(config)).status_code == 403


def test_orders_are_capped_and_idempotent(live_config):
    fake = FakeExchange()
    with TestClient(create_app(live_config, lambda options: fake)) as client:
        headers = auth(live_config)
        assert client.post('/api/order', json=order(101), headers=headers).status_code == 400
        payload = order(100)
        first = client.post('/api/order', json=payload, headers=headers)
        assert first.status_code == 200, first.text
        second = client.post('/api/order', json=payload, headers=headers)
        assert second.json() == first.json()
        assert len(fake.orders) == 1
        assert client.post('/api/order', json={**payload, 'notional': 90}, headers=headers).status_code == 409
        assert client.post('/api/order', json=order(100), headers=headers).status_code == 200
        assert client.post('/api/order', json=order(10), headers=headers).status_code == 400
        assert len(fake.orders) == 2


def test_uncertain_order_is_never_retried(live_config):
    fake = FakeExchange(); fake.fail_order = True
    with TestClient(create_app(live_config, lambda options: fake)) as client:
        payload = order()
        assert client.post('/api/order', json=payload, headers=auth(live_config)).status_code == 502
        assert client.post('/api/order', json=payload, headers=auth(live_config)).status_code == 409
        assert len(fake.orders) == 1
        assert client.app.state.desk.db.daily_buys() == 50


def test_invalid_and_nonfinite_orders_rejected(live_config):
    with TestClient(create_app(live_config, FakeExchange)) as client:
        for payload in [order(-1), order(0), order(side='short'), order(asset='DOGE'), order(request_id='invalid')]:
            assert client.post('/api/order', json=payload, headers=auth(live_config)).status_code == 422


def test_automation_opt_in_stop_and_invalid_rules(live_config):
    with TestClient(create_app(live_config, FakeExchange)) as client:
        assert client.get('/api/automation', headers=auth(live_config)).json()['enabled'] is False
        payload = {'enabled': True, 'asset': 'BTC', 'notional': 50, 'threshold': 70, 'exitThreshold': 40}
        assert client.post('/api/automation', json=payload, headers=auth(live_config)).status_code == 200
        assert client.post('/api/automation', json={'enabled': False}, headers=auth(live_config)).json()['enabled'] is False
        assert client.post('/api/automation', json={**payload, 'exitThreshold': 90}, headers=auth(live_config)).status_code == 400


def test_reconciliation_requires_explicit_confirmation_and_stopped_automation(live_config):
    with TestClient(create_app(live_config, FakeExchange)) as client:
        headers = auth(live_config)
        assert client.post('/api/automation/reconcile', json={}, headers=headers).status_code == 422
        client.post('/api/automation', json={'enabled': True, 'asset': 'BTC', 'notional': 50}, headers=headers)
        body = {'confirmation': 'exchange-checked-and-positions-closed'}
        assert client.post('/api/automation/reconcile', json=body, headers=headers).status_code == 409
        client.post('/api/automation', json={'enabled': False}, headers=headers)
        response = client.post('/api/automation/reconcile', json=body, headers=headers)
        assert response.status_code == 200
        assert response.json()['position'] is None
        assert response.json()['uncertain'] is False


def test_mobile_notifications_require_owner_configuration(config):
    with TestClient(create_app(config, FakeExchange)) as client:
        assert client.post('/api/notify', json={'title': 'Test', 'body': 'Test'}, headers=auth(config)).status_code == 409


def test_rss_and_social_polarity_is_bounded():
    assert polarity('bullish growth buy breakout') == 95
    assert polarity('bearish crash hack') == 5
    assert polarity('a general market update') == 50
    assert aggregate([]) is None
    assert aggregate([{'source': 'News', 'score': 70, 'count': 3}]) == 70


def test_short_token_fails_before_server_starts(config):
    with pytest.raises(RuntimeError, match='SENTRA_ADMIN_TOKEN'):
        with TestClient(create_app(replace(config, token=''), FakeExchange)):
            pass


def test_automation_entries_exit_and_restart_disarming(live_config):
    class FakeProviders:
        price = 100
        score = 80
        async def snapshot(self, asset):
            return {'price': self.price, 'sources': [{'source': 'Social', 'score': self.score, 'count': 1}], 'candles': [{'close': 100} for _ in range(30)]}
        async def notify(self, title, body):
            return True
    async def scenario():
        db, fake, provider = Database(live_config.db_path), FakeExchange(), FakeProviders()
        desk = Desk(live_config, db, fake, provider)
        await desk.configure_automation(Automation(enabled=True, asset='BTC', notional=50))
        await desk.automation_tick()
        assert desk.automation['position']['quantity'] == .5
        await desk.automation_tick()
        assert len(fake.orders) == 1
        provider.score = 20
        await desk.automation_tick()
        assert desk.automation['position'] is None
        assert len(fake.orders) == 2
        restarted = Desk(live_config, db, fake, provider)
        assert restarted.automation['enabled'] is False
        db.close()
    asyncio.run(scenario())


def test_restart_never_forgets_an_unresolved_automation_order(live_config):
    db = Database(live_config.db_path)
    db.set_state('automation', {'enabled': True, 'pendingRequest': str(uuid4())})
    desk = Desk(live_config, db, FakeExchange(), None)
    assert desk.automation['enabled'] is False
    assert desk.automation['uncertain'] is True
    db.close()
