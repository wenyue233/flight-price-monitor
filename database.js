/**
 * SQLite 数据访问层。
 *
 * 所有 SQL 都集中在这里，避免业务流程散落数据库细节。
 * 使用 Node.js 内置 node:sqlite，少一个原生依赖，安装更稳定。
 */

const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db;

function tableExists(database, tableName) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);

  return Boolean(row);
}

function columnExists(database, tableName, columnName) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(database, tableName, columnName, definition) {
  if (!columnExists(database, tableName, columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function migrateOldPriceRecords(database) {
  if (!tableExists(database, 'price_records')) {
    return;
  }

  const count = database.prepare('SELECT COUNT(*) AS count FROM price_history').get();
  if (count.count > 0) {
    return;
  }

  // 旧版本表名是 price_records。首次升级时复制旧数据，不删除原表。
  database.exec(`
    INSERT INTO price_history (
      observed_date,
      observed_time,
      observed_at,
      query_time,
      price,
      currency,
      site,
      departure_airport,
      arrival_airport,
      departure_date,
      return_date,
      raw_price_text,
      created_at
    )
    SELECT
      observed_date,
      observed_time,
      observed_at,
      observed_at,
      price,
      currency,
      site,
      departure_airport,
      arrival_airport,
      departure_date,
      return_date,
      raw_price_text,
      created_at
    FROM price_records;
  `);
}

async function initializeDatabase() {
  if (db) {
    return db;
  }

  db = new DatabaseSync(config.database.filename);

  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observed_date TEXT NOT NULL,
      observed_time TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      query_time TEXT,
      price INTEGER NOT NULL,
      currency TEXT NOT NULL,
      site TEXT NOT NULL,
      route TEXT,
      departure_airport TEXT NOT NULL,
      arrival_airport TEXT NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT,
      outbound_flight_no TEXT,
      return_flight_no TEXT,
      airline TEXT,
      outbound_airline TEXT,
      return_airline TEXT,
      outbound_time TEXT,
      return_time TEXT,
      outbound_departure_time TEXT,
      outbound_arrival_time TEXT,
      return_departure_time TEXT,
      return_arrival_time TEXT,
      is_direct INTEGER,
      match_status TEXT,
      original_price INTEGER,
      original_price_text TEXT,
      raw_price_text TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_lookup
    ON price_history (
      site,
      departure_airport,
      arrival_airport,
      departure_date,
      return_date,
      observed_date
    );
  `);

  addColumnIfMissing(db, 'price_history', 'query_time', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'route', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'outbound_flight_no', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'return_flight_no', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'airline', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'outbound_airline', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'return_airline', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'outbound_time', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'return_time', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'outbound_departure_time', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'outbound_arrival_time', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'return_departure_time', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'return_arrival_time', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'is_direct', 'INTEGER');
  addColumnIfMissing(db, 'price_history', 'match_status', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'original_price', 'INTEGER');
  addColumnIfMissing(db, 'price_history', 'original_price_text', 'TEXT');
  addColumnIfMissing(db, 'price_history', 'raw_price_text', 'TEXT');
  migrateOldPriceRecords(db);

  return db;
}

async function insertPriceRecord(record) {
  const database = await initializeDatabase();

  const statement = database.prepare(`
      INSERT INTO price_history (
        observed_date,
        observed_time,
        observed_at,
        query_time,
        price,
        currency,
        site,
        route,
        departure_airport,
        arrival_airport,
        departure_date,
        return_date,
        outbound_flight_no,
        return_flight_no,
        airline,
        outbound_airline,
        return_airline,
        outbound_time,
        return_time,
        outbound_departure_time,
        outbound_arrival_time,
        return_departure_time,
        return_arrival_time,
        is_direct,
        match_status,
        original_price,
        original_price_text,
        raw_price_text
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

  const result = statement.run(
    record.observedDate,
    record.observedTime,
    record.observedAt,
    record.queryTime || record.observedAt,
    record.price,
    record.currency,
    record.site,
    record.route || `${record.departureAirport} -> ${record.arrivalAirport}`,
    record.departureAirport,
    record.arrivalAirport,
    record.departureDate,
    record.returnDate || null,
    record.outboundFlightNo || null,
    record.returnFlightNo || null,
    record.airline || null,
    record.outboundAirline || record.airline || null,
    record.returnAirline || record.airline || null,
    record.outboundTime || null,
    record.returnTime || null,
    record.outboundDepartureTime || null,
    record.outboundArrivalTime || null,
    record.returnDepartureTime || null,
    record.returnArrivalTime || null,
    record.isDirect ? 1 : 0,
    record.matchStatus || null,
    record.originalPrice || null,
    record.originalPriceText || null,
    record.rawPriceText || null
  );

  return Number(result.lastInsertRowid);
}

async function getLatestRecordForDate({ site, route, observedDate }) {
  const database = await initializeDatabase();

  const statement = database.prepare(`
      SELECT *
      FROM price_history
      WHERE site = ?
        AND departure_airport = ?
        AND arrival_airport = ?
        AND departure_date = ?
        AND COALESCE(return_date, '') = COALESCE(?, '')
        AND observed_date = ?
        AND match_status = 'matched'
      ORDER BY observed_at DESC, id DESC
      LIMIT 1
    `);

  return statement.get(
    site,
    route.departureAirport,
    route.arrivalAirport,
    route.departureDate,
    route.returnDate || '',
    observedDate
  );
}

async function getLatestRecord({ site, route }) {
  const database = await initializeDatabase();

  const statement = database.prepare(`
      SELECT *
      FROM price_history
      WHERE site = ?
        AND departure_airport = ?
        AND arrival_airport = ?
        AND departure_date = ?
        AND COALESCE(return_date, '') = COALESCE(?, '')
        AND match_status = 'matched'
      ORDER BY observed_at DESC, id DESC
      LIMIT 1
    `);

  return statement.get(
    site,
    route.departureAirport,
    route.arrivalAirport,
    route.departureDate,
    route.returnDate || ''
  );
}

async function getPreviousRecord({ site, route, beforeObservedAt }) {
  const database = await initializeDatabase();

  const statement = database.prepare(`
      SELECT *
      FROM price_history
      WHERE site = ?
        AND departure_airport = ?
        AND arrival_airport = ?
        AND departure_date = ?
        AND COALESCE(return_date, '') = COALESCE(?, '')
        AND match_status = 'matched'
        AND observed_at < ?
      ORDER BY observed_at DESC, id DESC
      LIMIT 1
    `);

  return statement.get(
    site,
    route.departureAirport,
    route.arrivalAirport,
    route.departureDate,
    route.returnDate || '',
    beforeObservedAt
  );
}

async function getPriceStats({ site, route }) {
  const database = await initializeDatabase();

  const statement = database.prepare(`
      SELECT
        MIN(price) AS lowest_price,
        MAX(price) AS highest_price,
        COUNT(*) AS record_count
      FROM price_history
      WHERE site = ?
        AND departure_airport = ?
        AND arrival_airport = ?
        AND departure_date = ?
        AND COALESCE(return_date, '') = COALESCE(?, '')
        AND match_status = 'matched'
    `);

  return statement.get(
    site,
    route.departureAirport,
    route.arrivalAirport,
    route.departureDate,
    route.returnDate || ''
  );
}

async function getRecentRecords({ site, route, limit = 200 }) {
  const database = await initializeDatabase();

  const statement = database.prepare(`
      SELECT *
      FROM price_history
      WHERE site = ?
        AND departure_airport = ?
        AND arrival_airport = ?
        AND departure_date = ?
        AND COALESCE(return_date, '') = COALESCE(?, '')
        AND match_status = 'matched'
      ORDER BY observed_at DESC, id DESC
      LIMIT ?
    `);

  return statement.all(
    site,
    route.departureAirport,
    route.arrivalAirport,
    route.departureDate,
    route.returnDate || '',
    limit
  );
}

async function closeDatabase() {
  if (!db) {
    return;
  }

  db.close();
  db = null;
}

module.exports = {
  initializeDatabase,
  insertPriceRecord,
  getLatestRecordForDate,
  getLatestRecord,
  getPreviousRecord,
  getPriceStats,
  getRecentRecords,
  closeDatabase
};
