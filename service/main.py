"""Personal, authenticated service. Static demo never needs this process."""
import asyncio
from contextlib import asynccontextmanager
import csv
import hmac
import io
import json
import math
import time
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

import ccxt.async_support as ccxt
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .config import Config
from .database import Database
from .providers import Providers, aggregate, rsi

Asset = Literal['BTC', 'ETH', 'SOL']


class Order(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')
    asset: Asset
    side: Literal['buy', 'sell']
    notional: float = Field(gt=0)
    requestId: UUID


class Automation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')
    enabled: bool
    asset: Asset | None = None
    threshold: float = Field(default=75, ge=0, le=100)
    exitThreshold: float = Field(default=40, ge=0, le=100)
    notional: float = Field(default=0, ge=0)
    stopPct: float = Field(default=2, gt=0, le=20)
    rsiMax: float = Field(default=70, ge=0, le=100)


class Notification(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=1000)


class Reconciliation(BaseModel):
    confirmation: Literal['exchange-checked-and-positions-closed']


class Desk:
    def __init__(self, config, db, exchange, providers):
        self.config, self.db, self.exchange, self.providers = config, db, exchange, providers
        self.order_lock = asyncio.Lock()
        self.automation_lock = asyncio.Lock()
        previous = db.state('automation', {})
        self.automation = {**previous, 'enabled': False, 'uncertain': bool(previous.get('uncertain') or previous.get('pendingRequest')), 'reason': 'Automation starts disarmed. Review any existing exchange position before rearming.'}
        self.db.set_state('automation', self.automation)

    async def order(self, order: Order, quantity_override=None):
        if not self.config.live_ready:
            raise HTTPException(403, 'Live trading is disabled on this service.')
        async with self.order_lock:
            request_id = str(order.requestId)
            payload = order.model_dump_json()
            existing = self.db.order(request_id)
            if existing:
                if existing['payload'] != payload:
                    raise HTTPException(409, 'This request ID was used with different order details.')
                if existing['status'] != 'submitted':
                    raise HTTPException(409, 'Order outcome is uncertain. Check the exchange; this request will not be resubmitted.')
                return json.loads(existing['result'])
            if order.notional > self.config.max_order and quantity_override is None:
                raise HTTPException(400, 'Order exceeds the owner-configured per-order cap.')
            if order.side == 'buy' and self.db.daily_buys() + order.notional > self.config.daily_limit:
                raise HTTPException(400, 'Order exceeds the owner-configured daily buy cap (UTC).')
            symbol = f'{order.asset}/USDT'
            try:
                await self.exchange.load_markets()
                market = self.exchange.market(symbol)
                if not market.get('spot') or market.get('active') is False:
                    raise HTTPException(400, 'Only active spot markets are supported.')
                ticker = await self.exchange.fetch_ticker(symbol)
                price = float(ticker['last'])
                if not math.isfinite(price) or price <= 0:
                    raise ValueError('No valid price')
                amount = float(self.exchange.amount_to_precision(symbol, quantity_override if quantity_override is not None else order.notional / price))
                if amount <= 0:
                    raise HTTPException(400, 'Order is below the exchange quantity precision.')
                cost = amount * price
                limits = market.get('limits', {})
                minimum = limits.get('cost', {}).get('min')
                if minimum and cost < minimum:
                    raise HTTPException(400, 'Order is below the exchange minimum value.')
                min_amount = limits.get('amount', {}).get('min')
                if min_amount and amount < min_amount:
                    raise HTTPException(400, 'Order is below the exchange minimum quantity.')
                balance = await self.exchange.fetch_balance()
                if order.side == 'buy' and float(balance.get('free', {}).get('USDT') or 0) < cost * 1.01:
                    raise HTTPException(400, 'Insufficient available USDT, including a 1% fee buffer.')
                if order.side == 'sell' and float(balance.get('free', {}).get(order.asset) or 0) < amount:
                    raise HTTPException(400, 'Insufficient available asset balance.')
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(502, 'Exchange preflight failed. Verify keys, pair support, and available balances.') from None
            # Durable reservation is committed BEFORE any side effect. Unknown outcomes are never retried.
            self.db.reserve_order(request_id, payload, order.side, order.notional)
            try:
                result = await self.exchange.create_order(symbol, 'market', order.side, amount, price)
                safe = {key: result.get(key) for key in ('id', 'symbol', 'side', 'status', 'filled', 'remaining', 'average', 'cost', 'fee')}
                if not safe['id']:
                    raise ValueError('Missing exchange order ID')
                self.db.finish_order(request_id, 'submitted', safe)
            except Exception:
                self.db.finish_order(request_id, 'uncertain', {'message': 'Check the exchange before any further order.'})
                raise HTTPException(502, 'Order outcome is uncertain. Check the exchange before placing another order.') from None
            try:
                await self.providers.notify('Sentra live order', f'{order.side.upper()} {symbol}. Exchange order {safe["id"]}. Check the exchange for fill status.')
            except Exception:
                pass  # A notification error must not turn a submitted order into a retry.
            return safe

    async def configure_automation(self, payload: Automation):
        async with self.automation_lock:
            if not payload.enabled:
                self.automation.update(enabled=False, reason='Stopped by owner. Any open position remains on the exchange.')
            else:
                if not self.config.live_ready:
                    raise HTTPException(403, 'Enable live trading with explicit caps on the service first.')
                if not payload.asset or not 0 < payload.notional <= self.config.max_order or payload.exitThreshold >= payload.threshold:
                    raise HTTPException(400, 'Select an asset, an order within your cap, and an exit threshold below the entry threshold.')
                position = self.automation.get('position')
                if position and payload.asset != position['asset']:
                    raise HTTPException(409, 'An existing automation position belongs to another asset. Manage that position before changing markets.')
                if self.automation.get('uncertain'):
                    raise HTTPException(409, 'An order has an uncertain outcome. Reconcile the exchange and database before rearming.')
                self.automation = {**payload.model_dump(), 'position': position, 'triggered': False, 'reason': 'Armed by owner.'}
            self.db.set_state('automation', self.automation)
            return self.automation

    async def automation_tick(self):
        async with self.automation_lock:
            rule = self.automation
            if not rule.get('enabled'):
                return
            try:
                snapshot = await self.providers.snapshot(rule['asset'])
                score = aggregate(snapshot['sources'])
                position = rule.get('position')
                if position:
                    stop_hit = snapshot['price'] <= position['entry'] * (1 - rule['stopPct'] / 100)
                    if stop_hit or (score is not None and score <= rule['exitThreshold']):
                        request_id = uuid4()
                        rule['pendingRequest'] = str(request_id)
                        self.db.set_state('automation', rule)
                        result = await self.order(Order(asset=rule['asset'], side='sell', notional=position['quantity'] * snapshot['price'], requestId=request_id), quantity_override=position['quantity'])
                        filled = float(result.get('filled') or 0)
                        if result.get('status') != 'closed' or filled < position['quantity'] * .999:
                            raise RuntimeError('Exit fill is incomplete or uncertain. Check the exchange.')
                        rule['position'] = None
                        rule['pendingRequest'] = None
                        rule['reason'] = 'Position closed by stop or sentiment exit.'
                elif score is not None:
                    met = score >= rule['threshold'] and rsi(snapshot['candles']) <= rule['rsiMax']
                    if met and not rule.get('triggered'):
                        rule['triggered'] = True
                        self.db.set_state('automation', rule)
                        try:
                            await self.providers.notify('Sentra live signal', f'{rule["asset"]} sentiment {score}; entry conditions met.')
                        except Exception:
                            pass
                        request_id = uuid4()
                        rule['pendingRequest'] = str(request_id)
                        self.db.set_state('automation', rule)
                        result = await self.order(Order(asset=rule['asset'], side='buy', notional=rule['notional'], requestId=request_id))
                        filled, average = float(result.get('filled') or 0), float(result.get('average') or 0)
                        if result.get('status') != 'closed' or filled <= 0 or average <= 0:
                            raise RuntimeError('Entry fill is incomplete or uncertain. Check the exchange.')
                        fee = result.get('fee') or {}
                        if fee.get('currency') == rule['asset']:
                            filled -= float(fee.get('cost') or 0)
                        rule['position'] = {'asset': rule['asset'], 'quantity': filled, 'entry': average, 'orderId': result['id']}
                        rule['pendingRequest'] = None
                        rule['reason'] = 'Entry filled; monitoring stop and sentiment exit.'
                    elif not met:
                        rule['triggered'] = False
            except Exception:
                rule['enabled'] = False
                pending = rule.get('pendingRequest')
                rule['uncertain'] = bool(pending and self.db.order(pending))
                if not rule['uncertain']:
                    rule['pendingRequest'] = None
                rule['reason'] = 'Automation paused after a provider or order error. Check exchange orders and balances before rearming.'
                # No raw exception is returned: provider errors can include credential-bearing URLs.
                try:
                    await self.providers.notify('Sentra automation paused', rule['reason'])
                except Exception:
                    pass
            finally:
                self.db.set_state('automation', rule)


def create_app(config=None, exchange_factory=None):
    config = config or Config.from_env()

    @asynccontextmanager
    async def lifespan(app):
        config.validate()
        db = Database(config.db_path)
        options = {'enableRateLimit': True, 'timeout': 20000, 'apiKey': config.api_key, 'secret': config.secret, 'password': config.password, 'options': {'defaultType': 'spot'}}
        exchange = exchange_factory(options) if exchange_factory else getattr(ccxt, config.exchange)(options)
        if config.sandbox:
            exchange.set_sandbox_mode(True)
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as http:
            providers = Providers(config, db, exchange, http)
            app.state.desk = Desk(config, db, exchange, providers)

            async def poll():
                while True:
                    await asyncio.sleep(config.poll_seconds)
                    await app.state.desk.automation_tick()

            task = asyncio.create_task(poll())
            try:
                yield
            finally:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                await exchange.close()
                db.close()

    app = FastAPI(title='Sentra private service', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=config.origins, allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type'])

    async def authorize(authorization: str = Header(default='')):
        expected = 'Bearer ' + config.token
        if len(config.token) < 32 or not hmac.compare_digest(authorization, expected):
            raise HTTPException(401, 'A valid personal access token is required.')

    @app.get('/api/health', dependencies=[Depends(authorize)])
    async def health():
        return {'ok': True, 'exchange': config.exchange, 'liveTrading': config.live_ready, 'sandbox': config.sandbox,
            'sources': {'social': bool(config.twitter_key), 'jev': bool(config.typesafe_key), 'news': bool(config.rss_url), 'onchain': bool(config.rpc_url)}, 'mobileNotifications': bool(config.ntfy_url)}

    @app.get('/api/snapshot', dependencies=[Depends(authorize)])
    async def snapshot(asset: Asset, interval: int = Query(default=15)):
        if interval not in (5, 15, 60, 240):
            raise HTTPException(422, 'Use a 5, 15, 60, or 240 minute interval.')
        try:
            return await app.state.desk.providers.snapshot(asset, interval)
        except Exception:
            raise HTTPException(502, 'Market data is unavailable. Check the exchange configuration, region access, and connectivity.') from None

    @app.get('/api/history', dependencies=[Depends(authorize)])
    async def history(asset: Asset, interval: int = Query(default=15)):
        if interval not in (5, 15, 60, 240):
            raise HTTPException(422, 'Use a 5, 15, 60, or 240 minute interval.')
        try:
            result = await app.state.desk.providers.snapshot(asset, interval)
        except Exception:
            raise HTTPException(502, 'Historical market data is unavailable.') from None
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(('time', 'open', 'high', 'low', 'close', 'volume', 'sentiment'))
        for c in result['candles']:
            if c['sentiment'] is not None:
                writer.writerow(c[k] for k in ('time', 'open', 'high', 'low', 'close', 'volume', 'sentiment'))
        return Response(buffer.getvalue(), media_type='text/csv', headers={'Content-Disposition': f'attachment; filename="sentra-{asset}-observed.csv"'})

    @app.post('/api/order', dependencies=[Depends(authorize)])
    async def order(payload: Order):
        return await app.state.desk.order(payload)

    @app.get('/api/automation', dependencies=[Depends(authorize)])
    async def automation_status():
        return app.state.desk.automation

    @app.post('/api/automation', dependencies=[Depends(authorize)])
    async def automation_configure(payload: Automation):
        return await app.state.desk.configure_automation(payload)

    @app.post('/api/automation/reconcile', dependencies=[Depends(authorize)])
    async def reconcile(payload: Reconciliation):
        desk = app.state.desk
        async with desk.automation_lock:
            if desk.automation.get('enabled'):
                raise HTTPException(409, 'Stop automation before clearing resolved state.')
            desk.db.set_state('last_reconciliation', {'time': time.time(), 'previous': desk.automation})
            desk.automation = {'enabled': False, 'uncertain': False, 'position': None, 'pendingRequest': None,
                'reason': 'Owner confirmed that exchange orders were checked and automation positions were closed. Order ledger retained.'}
            desk.db.set_state('automation', desk.automation)
            return desk.automation

    @app.post('/api/notify', dependencies=[Depends(authorize)])
    async def send_notification(payload: Notification):
        try:
            sent = await app.state.desk.providers.notify(payload.title, payload.body)
        except Exception:
            raise HTTPException(502, 'Mobile delivery failed. Check the ntfy service and topic permissions.') from None
        if not sent:
            raise HTTPException(409, 'Configure NTFY_TOPIC_URL on your private service to enable mobile delivery.')
        return {'sent': True}

    dist = Path(__file__).resolve().parents[1] / 'dist'
    if dist.exists():
        app.mount('/', StaticFiles(directory=dist, html=True), name='web')
    return app


app = create_app()
