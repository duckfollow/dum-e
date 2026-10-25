use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Column, ConnectOptions, Connection, Executor, Row, TypeInfo, ValueRef};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub driver: String,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub path: String,
    #[serde(default = "default_tls")]
    pub tls: bool,
    #[serde(default)]
    pub remember_password: bool,
}
fn default_port() -> u16 {
    5432
}
fn default_tls() -> bool {
    true
}
impl Profile {
    pub fn validate(&self) -> Result<(), String> {
        uuid::Uuid::parse_str(&self.id).map_err(|_| "Invalid connection identifier")?;
        if self.name.trim().is_empty() || self.name.len() > 100 {
            return Err("Give this connection a name (up to 100 characters).".into());
        }
        match self.driver.as_str() {
            "sqlite" => {
                if !std::path::Path::new(&self.path).is_absolute()
                    || !std::path::Path::new(&self.path).is_file()
                {
                    return Err("Choose an existing SQLite file.".into());
                }
            }
            "postgres" => {
                if self.host.trim().is_empty()
                    || self.host.len() > 253
                    || self.host.contains(['/', '\\', '@', '?', '#'])
                    || self.port == 0
                    || self.database.is_empty()
                    || self.username.is_empty()
                {
                    return Err("Enter a host, port, database and username.".into());
                }
                if self.database.len() > 256 || self.username.len() > 256 {
                    return Err("Database or username is too long.".into());
                }
                if !self.tls && !["localhost", "127.0.0.1", "::1"].contains(&self.host.as_str()) {
                    return Err("Remote PostgreSQL connections require verified TLS.".into());
                }
            }
            _ => return Err("This version supports PostgreSQL and SQLite.".into()),
        }
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub name: String,
    pub data_type: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<Field>,
    pub rows: Vec<Vec<Value>>,
    pub elapsed_ms: u128,
    pub truncated: bool,
    pub affected_rows: Option<u64>,
    // Raw JSON text preserves large numbers, duplicate keys and JSON null vs SQL NULL.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub json_raw: BTreeMap<usize, BTreeMap<usize, String>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Table {
    pub schema: String,
    pub name: String,
    pub kind: String,
}
pub fn quoted(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}
pub fn validate_sql(sql: &str, postgres: bool) -> Result<(), String> {
    use sqlparser::{
        ast::Statement,
        dialect::{PostgreSqlDialect, SQLiteDialect},
        parser::Parser,
    };
    if sql.trim().is_empty() || sql.len() > 65536 {
        return Err("Enter a query up to 64 KB.".into());
    }
    let statements = if postgres {
        Parser::parse_sql(&PostgreSqlDialect {}, sql)
    } else {
        Parser::parse_sql(&SQLiteDialect {}, sql)
    }
    .map_err(|e| format!("SQL: {e}"))?;
    if statements.len() != 1 || !matches!(statements[0], Statement::Query(_)) {
        return Err(
            "Table previews accept one SELECT or WITH query. Use a SQL tab to run SQL scripts."
                .into(),
        );
    }
    Ok(())
}
fn value_limit(value: Value) -> Result<Value, String> {
    if value.to_string().len() > 65536 {
        return Err(
            "A cell exceeds the 64 KB preview limit. Select a smaller subset or cast it in SQL."
                .into(),
        );
    }
    Ok(value)
}
pub(crate) fn sqlite_cell(row: &sqlx::sqlite::SqliteRow, index: usize) -> Result<Value, String> {
    let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
    if raw.is_null() {
        return Ok(Value::Null);
    }
    let kind = raw.type_info().name().to_owned();
    let value = match kind.as_str() {
        "INTEGER" | "BOOLEAN" => Value::String(
            row.try_get::<i64, _>(index)
                .map_err(|e| e.to_string())?
                .to_string(),
        ),
        "REAL" => {
            let v = row.try_get::<f64, _>(index).map_err(|e| e.to_string())?;
            if v.is_finite() {
                json!(v)
            } else {
                json!(v.to_string())
            }
        }
        "BLOB" => {
            let bytes: Vec<u8> = row.try_get(index).map_err(|e| e.to_string())?;
            json!({"binaryBytes":bytes.len(),"hexPreview":bytes.iter().take(32).map(|b|format!("{b:02x}")).collect::<String>()})
        }
        _ => json!(row.try_get::<String, _>(index).map_err(|e| e.to_string())?),
    };
    value_limit(value)
}
pub(crate) fn pg_cell(row: &sqlx::postgres::PgRow, index: usize) -> Result<Value, String> {
    let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
    if raw.is_null() {
        return Ok(Value::Null);
    }
    macro_rules! get {
        ($t:ty) => {
            row.try_get::<$t, _>(index).map_err(|e| e.to_string())?
        };
    }
    let kind = raw.type_info().name().to_owned();
    let value = match kind.as_str() {
        "BOOL" => json!(get!(bool)),
        "INT2" => json!(get!(i16).to_string()),
        "INT4" => json!(get!(i32).to_string()),
        "INT8" => json!(get!(i64).to_string()),
        "FLOAT4" => {
            let v = get!(f32);
            if v.is_finite() {
                json!(v)
            } else {
                json!(v.to_string())
            }
        }
        "FLOAT8" => {
            let v = get!(f64);
            if v.is_finite() {
                json!(v)
            } else {
                json!(v.to_string())
            }
        }
        "NUMERIC" => json!(get!(bigdecimal::BigDecimal).normalized().to_string()),
        "JSON" | "JSONB" => get!(Value),
        "UUID" => json!(get!(uuid::Uuid).to_string()),
        "DATE" => json!(get!(chrono::NaiveDate).to_string()),
        "TIME" => json!(get!(chrono::NaiveTime).to_string()),
        "TIMESTAMP" => json!(get!(chrono::NaiveDateTime).to_string()),
        "TIMESTAMPTZ" => json!(get!(chrono::DateTime<chrono::Utc>).to_rfc3339()),
        "BYTEA" => {
            let bytes = get!(Vec<u8>);
            json!({"binaryBytes":bytes.len(),"hexPreview":bytes.iter().take(32).map(|b|format!("{b:02x}")).collect::<String>()})
        }
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "UNKNOWN" => json!(get!(String)),
        _ => {
            return Err(format!(
                "Column {} uses {kind}, which is not previewed yet. Cast it to text in SQL.",
                row.columns()[index].name()
            ))
        }
    };
    value_limit(value)
}
pub(crate) fn pg_json_raw(row: &sqlx::postgres::PgRow) -> Result<BTreeMap<usize, String>, String> {
    let mut output = BTreeMap::new();
    for (i, column) in row.columns().iter().enumerate() {
        let kind = column.type_info().name();
        if !matches!(kind, "JSON" | "JSONB") {
            continue;
        }
        let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
        if raw.is_null() {
            continue;
        }
        let mut bytes = raw.as_bytes().map_err(|e| e.to_string())?;
        if kind == "JSONB" && raw.format() == sqlx::postgres::PgValueFormat::Binary {
            if bytes.first() != Some(&1) {
                return Err("Unsupported JSONB wire version".into());
            }
            bytes = &bytes[1..];
        }
        if bytes.len() > 65536 {
            return Err("A JSON cell exceeds the 64 KB preview limit.".into());
        }
        output.insert(
            i,
            std::str::from_utf8(bytes)
                .map_err(|e| e.to_string())?
                .to_owned(),
        );
    }
    Ok(output)
}
pub(crate) fn sqlite_json_raw(
    _row: &sqlx::sqlite::SqliteRow,
) -> Result<BTreeMap<usize, String>, String> {
    Ok(BTreeMap::new())
}
pub(crate) async fn sqlite(
    profile: &Profile,
    cancel: Arc<AtomicBool>,
) -> Result<sqlx::SqliteConnection, String> {
    sqlite_mode(profile, cancel, false).await
}
pub(crate) async fn sqlite_mode(
    profile: &Profile,
    cancel: Arc<AtomicBool>,
    writable: bool,
) -> Result<sqlx::SqliteConnection, String> {
    let opts = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&profile.path)
        .read_only(!writable)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(3))
        .disable_statement_logging();
    let mut c = sqlx::SqliteConnection::connect_with(&opts)
        .await
        .map_err(|e| e.to_string())?;
    c.execute(if writable {
        "PRAGMA query_only=OFF"
    } else {
        "PRAGMA query_only=ON"
    })
    .await
    .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(15);
    c.lock_handle()
        .await
        .map_err(|e| e.to_string())?
        .set_progress_handler(1000, move || {
            !cancel.load(Ordering::Relaxed) && Instant::now() < deadline
        });
    Ok(c)
}
pub(crate) async fn postgres(
    profile: &Profile,
    password: &str,
) -> Result<sqlx::PgConnection, String> {
    postgres_mode(profile, password, false).await
}
pub(crate) async fn postgres_mode(
    profile: &Profile,
    password: &str,
    writable: bool,
) -> Result<sqlx::PgConnection, String> {
    let opts = sqlx::postgres::PgConnectOptions::new_without_pgpass()
        .host(&profile.host)
        .port(profile.port)
        .database(&profile.database)
        .username(&profile.username)
        .password(password)
        .ssl_mode(if profile.tls {
            sqlx::postgres::PgSslMode::VerifyFull
        } else {
            sqlx::postgres::PgSslMode::Disable
        })
        .application_name("Dum-E")
        .options([
            (
                "default_transaction_read_only",
                if writable { "off" } else { "on" },
            ),
            ("statement_timeout", "15000"),
            ("lock_timeout", "3000"),
        ])
        .disable_statement_logging();
    tokio::time::timeout(
        Duration::from_secs(8),
        sqlx::PgConnection::connect_with(&opts),
    )
    .await
    .map_err(|_| "Connection timed out after 8 seconds".to_string())?
    .map_err(|e| e.to_string())
}
pub async fn test_connection(profile: &Profile, password: &str) -> Result<(), String> {
    profile.validate()?;
    if profile.driver == "sqlite" {
        let mut c = sqlite(profile, Arc::new(AtomicBool::new(false))).await?;
        c.execute("SELECT 1").await.map_err(|e| e.to_string())?;
        c.close().await.map_err(|e| e.to_string())?;
    } else {
        let mut c = postgres(profile, password).await?;
        c.execute("SELECT 1").await.map_err(|e| e.to_string())?;
        c.close().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub async fn query(
    profile: &Profile,
    password: &str,
    sql: &str,
    cancel: Arc<AtomicBool>,
) -> Result<QueryResult, String> {
    profile.validate()?;
    validate_sql(sql, profile.driver == "postgres")?;
    let start = Instant::now();
    let mut rows = Vec::new();
    let mut json_raw = BTreeMap::new();
    let mut size = 0;
    let mut truncated = false;
    let columns;
    if profile.driver == "sqlite" {
        let mut c = sqlite(profile, cancel.clone()).await?;
        columns = c
            .describe(sql)
            .await
            .map_err(|e| e.to_string())?
            .columns()
            .iter()
            .map(|c| Field {
                name: c.name().into(),
                data_type: c.type_info().name().into(),
            })
            .collect();
        let mut stream = sqlx::query(sql).fetch(&mut c);
        while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
            if cancel.load(Ordering::Relaxed) {
                return Err("Query cancelled".into());
            }
            if rows.len() == 200 {
                truncated = true;
                break;
            }
            let cells = (0..row.len())
                .map(|i| sqlite_cell(&row, i))
                .collect::<Result<Vec<_>, _>>()?;
            size += serde_json::to_vec(&cells).map_err(|e| e.to_string())?.len();
            if size > 4 * 1024 * 1024 {
                return Err("Result exceeds 4 MB. Select fewer columns or rows.".into());
            }
            rows.push(cells);
        }
    } else {
        let mut c = postgres(profile, password).await?;
        c.execute("BEGIN READ ONLY")
            .await
            .map_err(|e| e.to_string())?;
        columns = c
            .describe(sql)
            .await
            .map_err(|e| e.to_string())?
            .columns()
            .iter()
            .map(|c| Field {
                name: c.name().into(),
                data_type: c.type_info().name().into(),
            })
            .collect();
        let mut stream = sqlx::query(sql).fetch(&mut c);
        while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
            if cancel.load(Ordering::Relaxed) {
                return Err("Query cancelled".into());
            }
            if rows.len() == 200 {
                truncated = true;
                break;
            }
            let raw = pg_json_raw(&row)?;
            size += raw.values().map(String::len).sum::<usize>();
            if !raw.is_empty() {
                json_raw.insert(rows.len(), raw);
            }
            let cells = (0..row.len())
                .map(|i| pg_cell(&row, i))
                .collect::<Result<Vec<_>, _>>()?;
            size += serde_json::to_vec(&cells).map_err(|e| e.to_string())?.len();
            if size > 4 * 1024 * 1024 {
                return Err("Result exceeds 4 MB. Select fewer columns or rows.".into());
            }
            rows.push(cells);
        }
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Query cancelled".into());
    }
    Ok(QueryResult {
        columns,
        rows,
        elapsed_ms: start.elapsed().as_millis(),
        truncated,
        affected_rows: None,
        json_raw,
    })
}
pub async fn schemas(profile: &Profile, password: &str) -> Result<Vec<String>, String> {
    profile.validate()?;
    if profile.driver == "sqlite" {
        return Ok(vec!["main".into()]);
    }
    let mut c = postgres(profile, password).await?;
    let rows=sqlx::query("SELECT nspname::text AS name FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' AND (pg_has_role(nspowner,'USAGE') OR has_schema_privilege(oid,'USAGE') OR has_schema_privilege(oid,'CREATE')) ORDER BY nspname").fetch_all(&mut c).await.map_err(|e|e.to_string())?;
    Ok(rows.into_iter().map(|r| r.get("name")).collect())
}
pub async fn tables(profile: &Profile, password: &str) -> Result<Vec<Table>, String> {
    let sql = if profile.driver == "sqlite" {
        "SELECT 'main' AS schema, name, type AS kind FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    } else {
        "SELECT n.nspname::text AS schema, c.relname::text AS name, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'p' THEN 'partitioned table' WHEN 'f' THEN 'foreign table' ELSE 'table' END AS kind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND (pg_has_role(c.relowner,'USAGE') OR has_table_privilege(c.oid,'SELECT') OR has_any_column_privilege(c.oid,'SELECT')) ORDER BY n.nspname,c.relname"
    };
    // Metadata is not capped at the 200-row data preview limit.
    profile.validate()?;
    if profile.driver == "sqlite" {
        let mut c = sqlite(profile, Arc::new(AtomicBool::new(false))).await?;
        let rows = sqlx::query(sql)
            .fetch_all(&mut c)
            .await
            .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| Table {
                schema: r.get("schema"),
                name: r.get("name"),
                kind: r.get("kind"),
            })
            .collect())
    } else {
        let mut c = postgres(profile, password).await?;
        let rows = sqlx::query(sql)
            .fetch_all(&mut c)
            .await
            .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| Table {
                schema: r.get("schema"),
                name: r.get("name"),
                kind: r.get("kind"),
            })
            .collect())
    }
}
pub async fn demo_file(path: &std::path::Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let mut c = sqlx::SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| e.to_string())?;
    c.execute(include_str!("demo.sql"))
        .await
        .map_err(|e| e.to_string())?;
    c.close().await.map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn profile(path: &std::path::Path) -> Profile {
        Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Test".into(),
            driver: "sqlite".into(),
            path: path.to_string_lossy().into(),
            host: String::new(),
            port: 5432,
            database: String::new(),
            username: String::new(),
            tls: true,
            remember_password: false,
        }
    }
    #[test]
    fn identifier_and_query_boundaries() {
        assert_eq!(quoted("a\"b"), "\"a\"\"b\"");
        for q in [
            "DELETE FROM users",
            "SELECT 1; DROP TABLE users",
            "ATTACH DATABASE '/tmp/x' AS x",
            "PRAGMA query_only=OFF",
            "",
        ] {
            assert!(validate_sql(q, false).is_err());
        }
        assert!(validate_sql("WITH x AS (SELECT 1) SELECT * FROM x", true).is_ok());
    }
    #[tokio::test]
    async fn sqlite_real_data_types_bounds_and_readonly() {
        let path = std::env::temp_dir().join(format!("dum-e-{}.sqlite", uuid::Uuid::new_v4()));
        demo_file(&path).await.unwrap();
        let p = profile(&path);
        let ts = tables(&p, "").await.unwrap();
        assert!(ts.iter().any(|t| t.name == "missions"));
        let r = query(
            &p,
            "",
            "SELECT 9007199254740993 AS large, NULL AS empty, x'0102' AS bytes",
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        assert_eq!(r.rows[0][0], json!("9007199254740993"));
        assert_eq!(r.rows[0][1], Value::Null);
        assert_eq!(r.rows[0][2]["binaryBytes"], 2);
        assert!(query(
            &p,
            "",
            "DELETE FROM missions",
            Arc::new(AtomicBool::new(false))
        )
        .await
        .is_err());
        let r=query(&p,"","WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<300) SELECT * FROM n",Arc::new(AtomicBool::new(false))).await.unwrap();
        assert_eq!(r.rows.len(), 200);
        assert!(r.truncated);
        let cancel = Arc::new(AtomicBool::new(true));
        assert!(query(&p, "", "SELECT * FROM missions", cancel)
            .await
            .is_err());
        assert_eq!(tables(&p, "").await.unwrap().len(), ts.len());
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    #[ignore = "requires isolated PostgreSQL; set DUM_E_TEST_PG_PORT"]
    async fn postgres_real_connection_types_and_readonly() {
        let port = std::env::var("DUM_E_TEST_PG_PORT")
            .expect("DUM_E_TEST_PG_PORT")
            .parse()
            .unwrap();
        let p = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Isolated Postgres".into(),
            driver: "postgres".into(),
            host: "127.0.0.1".into(),
            port,
            database: "postgres".into(),
            username: "postgres".into(),
            path: String::new(),
            tls: false,
            remember_password: false,
        };
        test_connection(&p, "dum-e-local-test-only").await.unwrap();
        let r = query(&p,"dum-e-local-test-only", "SELECT 9007199254740993::bigint AS big, 1234567890.123456789::numeric AS exact, true AS ok, NULL::text AS empty, '{\"a\":1}'::jsonb AS doc, '2026-10-24'::date AS day",Arc::new(AtomicBool::new(false))).await.unwrap();
        assert_eq!(r.rows[0][0], json!("9007199254740993"));
        assert_eq!(r.rows[0][1], json!("1234567890.123456789"));
        assert_eq!(r.rows[0][2], json!(true));
        assert_eq!(r.rows[0][3], Value::Null);
        assert_eq!(r.rows[0][4], json!({"a":1}));
        assert_eq!(r.rows[0][5], json!("2026-10-24"));
        let fidelity = query(
            &p, "dum-e-local-test-only",
            r#"SELECT 'null'::json, NULL::json, '{"id":9007199254740993,"id":9007199254740994}'::json, '{"exact":1234567890.123456789}'::jsonb"#,
            Arc::new(AtomicBool::new(false)),
        ).await.unwrap();
        let raw = &fidelity.json_raw[&0];
        assert_eq!(raw[&0], "null");
        assert!(!raw.contains_key(&1));
        assert_eq!(raw[&2], r#"{"id":9007199254740993,"id":9007199254740994}"#);
        assert!(raw[&3].contains("1234567890.123456789"));
        let r = query(
            &p,
            "dum-e-local-test-only",
            "SELECT * FROM generate_series(1,250)",
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        assert_eq!(r.rows.len(), 200);
        assert!(r.truncated);
        let forbidden = query(
            &p,
            "dum-e-local-test-only",
            "WITH changed AS (DELETE FROM dum_e_test_items RETURNING *) SELECT * FROM changed",
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .err()
        .expect("write must fail");
        assert!(forbidden.contains("read-only"), "{forbidden}");
        assert!(tables(&p, "dum-e-local-test-only")
            .await
            .unwrap()
            .iter()
            .any(|t| t.name == "dum_e_test_items"));
        let mut remote = p.clone();
        remote.host = "example.com".into();
        assert!(remote.validate().is_err());
    }
    #[tokio::test]
    async fn sqlite_cancels_expensive_query_and_keeps_empty_columns() {
        let path =
            std::env::temp_dir().join(format!("dum-e-cancel-{}.sqlite", uuid::Uuid::new_v4()));
        demo_file(&path).await.unwrap();
        let p = profile(&path);
        let empty = query(
            &p,
            "",
            "SELECT * FROM missions WHERE 0",
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        assert_eq!(empty.columns.len(), 7);
        assert!(empty.rows.is_empty());
        let flag = Arc::new(AtomicBool::new(false));
        let signal = flag.clone();
        let stop = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            signal.store(true, Ordering::Relaxed);
        });
        let result=tokio::time::timeout(Duration::from_secs(3),query(&p,"","WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT SUM(x) FROM n",flag)).await.expect("SQLite must interrupt promptly");
        assert!(result.is_err());
        stop.await.unwrap();
        std::fs::remove_file(path).unwrap();
    }
}
