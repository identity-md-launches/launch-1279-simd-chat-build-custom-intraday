import json
import sqlite3
from pathlib import Path
import time


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS observations (
            asset TEXT, id TEXT, time INTEGER, source TEXT, payload TEXT,
            PRIMARY KEY(asset, id)
          );
          CREATE TABLE IF NOT EXISTS sentiment (asset TEXT, time INTEGER, score REAL,
            PRIMARY KEY(asset, time));
          CREATE TABLE IF NOT EXISTS orders (
            request_id TEXT PRIMARY KEY, payload TEXT, status TEXT,
            result TEXT, created REAL, side TEXT, notional REAL
          );
          CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
        ''')
        self.connection.commit()

    def add_observations(self, asset, items):
        for item in items:
            self.connection.execute('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?)',
                (asset, item['id'], item['time'], item['source'], json.dumps(item)))
        # Bound the single-user cache to seven days of observed provider items.
        self.connection.execute('DELETE FROM observations WHERE time < ?', (int(time.time() * 1000) - 7 * 86400000,))
        self.connection.commit()

    def observations(self, asset, source, since):
        return [json.loads(row[0]) for row in self.connection.execute(
            'SELECT payload FROM observations WHERE asset=? AND source=? AND time>=? ORDER BY time DESC LIMIT 500',
            (asset, source, since))]

    def has_observation(self, asset, item_id):
        return self.connection.execute('SELECT 1 FROM observations WHERE asset=? AND id=?', (asset, item_id)).fetchone() is not None

    def store_score(self, asset, timestamp, score):
        if score is not None:
            self.connection.execute('INSERT OR REPLACE INTO sentiment VALUES(?,?,?)', (asset, timestamp, score))
            self.connection.commit()

    def scores(self, asset, start, end):
        return [dict(row) for row in self.connection.execute('SELECT time,score FROM sentiment WHERE asset=? AND time>=? AND time<=? ORDER BY time', (asset, start, end))]

    def state(self, key, default=None):
        row = self.connection.execute('SELECT value FROM state WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_state(self, key, value):
        self.connection.execute('INSERT OR REPLACE INTO state VALUES(?,?)', (key, json.dumps(value)))
        self.connection.commit()

    def order(self, request_id):
        row = self.connection.execute('SELECT * FROM orders WHERE request_id=?', (request_id,)).fetchone()
        return dict(row) if row else None

    def reserve_order(self, request_id, payload, side, notional):
        self.connection.execute('INSERT INTO orders VALUES(?,?,?,?,?,?,?)',
            (request_id, payload, 'pending', '{}', time.time(), side, notional))
        self.connection.commit()

    def finish_order(self, request_id, status, result):
        self.connection.execute('UPDATE orders SET status=?,result=? WHERE request_id=?', (status, json.dumps(result), request_id))
        self.connection.commit()

    def daily_buys(self):
        midnight = int(time.time() // 86400) * 86400
        # Uncertain and pending orders consume budget too; no automatic retry.
        return self.connection.execute("SELECT COALESCE(SUM(notional),0) FROM orders WHERE side='buy' AND created>=?", (midnight,)).fetchone()[0]

    def close(self):
        self.connection.close()
