//! SQL runs with database-role/file permissions. Statements go unchanged to the driver.
use crate::db::{self, Field, Profile, QueryResult};
use futures_util::TryStreamExt;
use serde::Serialize;
use sqlx::{Column, Either, Row, TypeInfo, ValueRef};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    pub results: Vec<QueryResult>,
    pub error: Option<String>,
    pub elapsed_ms: u128,
    pub omitted_results: usize,
}
fn permission_error(error: &sqlx::Error, profile: &Profile) -> String {
    let hint = match error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("42501") =>
            format!("PostgreSQL user '{}' does not have permission for this operation. Check role grants and object ownership.\n", profile.username),
        sqlx::Error::Database(db) if db.code().as_deref() == Some("25006") =>
            "The database is enforcing a read-only transaction or server state.\n".into(),
        sqlx::Error::Database(db) if profile.driver == "sqlite" && db.code().and_then(|c|c.parse::<i32>().ok()).is_some_and(|code|code & 255 == 8) =>
            "SQLite cannot write to this database. Check file and parent-folder permissions.\n".into(),
        _ => String::new(),
    };
    format!("{hint}{error}")
}
fn empty() -> QueryResult {
    QueryResult {
        columns: vec![],
        rows: vec![],
        elapsed_ms: 0,
        truncated: false,
        affected_rows: None,
        json_raw: Default::default(),
    }
}
// Continue consuming after preview limits. Breaking a RETURNING stream could leave
// writes incomplete or report success before the server commits the script.
fn retain(
    row: Vec<serde_json::Value>,
    raw: std::collections::BTreeMap<usize, String>,
    current: &mut QueryResult,
    bytes: &mut usize,
) {
    let size = serde_json::to_vec(&row)
        .map(|v| v.len())
        .unwrap_or(usize::MAX)
        .saturating_add(raw.values().map(String::len).sum::<usize>());
    if current.rows.len() >= 200 || bytes.saturating_add(size) > 4 * 1024 * 1024 {
        current.truncated = true;
    } else {
        *bytes += size;
        if !raw.is_empty() {
            current.json_raw.insert(current.rows.len(), raw);
        }
        current.rows.push(row);
    }
}
pub async fn execute(
    profile: &Profile,
    password: &str,
    sql: &str,
    cancel: Arc<AtomicBool>,
) -> Result<ExecutionResult, String> {
    profile.validate()?;
    if sql.trim().is_empty() || sql.len() > 65536 {
        return Err("Enter SQL up to 64 KB.".into());
    }
    // SQLite reports the previous DML count for SELECT/DDL. Only label counts
    // as affected rows for parsed DML; parsing never gates raw SQL execution.
    use sqlparser::{
        ast::Statement,
        dialect::{PostgreSqlDialect, SQLiteDialect},
        parser::Parser,
    };
    let parsed = if profile.driver == "postgres" {
        Parser::parse_sql(&PostgreSqlDialect {}, sql)
    } else {
        Parser::parse_sql(&SQLiteDialect {}, sql)
    };
    let affected_commands: Vec<bool> = parsed
        .unwrap_or_default()
        .into_iter()
        .map(|s| {
            matches!(
                s,
                Statement::Insert(_)
                    | Statement::Update { .. }
                    | Statement::Delete(_)
                    | Statement::Merge { .. }
            )
        })
        .collect();
    let start = Instant::now();
    let mut output = ExecutionResult {
        results: vec![],
        error: None,
        elapsed_ms: 0,
        omitted_results: 0,
    };
    let mut current = empty();
    let mut bytes = 0usize;
    let mut preview_error = None;
    macro_rules! consume {
        ($connection:expr, $cell:path, $raw:path) => {{
            let mut stream = sqlx::raw_sql(sql).fetch_many($connection);
            loop {
                if cancel.load(Ordering::Relaxed) { output.error = Some("Execution cancelled. Some changes may already be committed; inspect the database before retrying.".into()); break; }
                match stream.try_next().await {
                    Ok(Some(Either::Right(row))) => {
                        if current.columns.is_empty() {
                            current.columns = row.columns().iter().enumerate().map(|(i,c)| {
                                let declared=c.type_info().name();
                                let data_type=if declared=="NULL" {row.try_get_raw(i).map(|v|v.type_info().name().to_owned()).unwrap_or_else(|_|declared.into())} else {declared.into()};
                                Field {name:c.name().into(), data_type}
                            }).collect();
                        }
                        if output.results.len() >= 100 { continue; }
                        match (0..row.len()).map(|i| $cell(&row,i)).collect::<Result<Vec<_>,_>>() {
                            Ok(cells) => match $raw(&row) {
                                Ok(raw) => retain(cells,raw,&mut current,&mut bytes),
                                Err(e) => { current.truncated=true; preview_error=Some(e); }
                            },
                            Err(e) => { current.truncated=true; preview_error=Some(e); }
                        }
                    }
                    Ok(Some(Either::Left(done))) => {
                        current.affected_rows=affected_commands.get(output.results.len()+output.omitted_results).copied().unwrap_or(false).then(||done.rows_affected());
                        current.elapsed_ms=start.elapsed().as_millis();
                        if output.results.len()<100 { output.results.push(current); } else { output.omitted_results+=1; }
                        current=empty();
                    }
                    Ok(None) => break,
                    Err(e) => {
                        output.error=Some(format!("{}\nExecution stopped. Completed statements are not a commit guarantee; earlier changes may be committed. Check the database before retrying.", permission_error(&e, profile)));
                        break;
                    }
                }
            }
        }};
    }
    if profile.driver == "sqlite" {
        let mut c = db::sqlite_mode(profile, cancel.clone(), true).await?;
        consume!(&mut c, db::sqlite_cell, db::sqlite_json_raw);
    } else {
        let mut c = db::postgres_mode(profile, password, true).await?;
        consume!(&mut c, db::pg_cell, db::pg_json_raw);
    }
    if let Some(e) = preview_error {
        let note=format!("SQL execution finished, but part of the result could not be previewed: {e}. Do not rerun writes just to refresh a preview.");
        output.error = Some(match output.error {
            Some(previous) => format!("{previous}\n{note}"),
            None => note,
        });
    }
    output.elapsed_ms = start.elapsed().as_millis();
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    struct Fixture(std::path::PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    fn sqlite_profile(path: &std::path::Path) -> Profile {
        Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Write fixture".into(),
            driver: "sqlite".into(),
            host: String::new(),
            port: 5432,
            database: String::new(),
            username: String::new(),
            path: path.to_string_lossy().into(),
            tls: true,
            remember_password: false,
        }
    }
    fn flag() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }
    #[tokio::test]
    async fn sqlite_scripts_ddl_dml_returning_and_readonly_boundary() {
        let file = Fixture(
            std::env::temp_dir().join(format!("dum-e-write-{}.sqlite", uuid::Uuid::new_v4())),
        );
        db::demo_file(&file.0).await.unwrap();
        let p = sqlite_profile(&file.0);
        let r=execute(&p,"","CREATE TABLE write_test(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO write_test(name) VALUES ('a;b'),('second'); UPDATE write_test SET name='updated' WHERE id=2 RETURNING id,name; SELECT * FROM write_test ORDER BY id;",flag()).await.unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results.len(), 4);
        assert_eq!(r.results[1].affected_rows, Some(2));
        assert_eq!(r.results[0].affected_rows, None);
        assert_eq!(r.results[3].affected_rows, None);
        assert_eq!(r.results[2].rows[0][1], json!("updated"));
        assert_eq!(r.results[3].rows[0][1], json!("a;b"));
        assert!(db::query(&p, "", "DELETE FROM write_test", flag())
            .await
            .is_err());
        let mut readonly = db::sqlite(&p, flag()).await.unwrap();
        use sqlx::Executor;
        assert!(readonly.execute("DELETE FROM write_test").await.is_err());
        let r=execute(&p,"","DELETE FROM write_test WHERE id=1; ALTER TABLE write_test ADD COLUMN active INTEGER DEFAULT 1; DROP TABLE write_test; VACUUM;",flag()).await.unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        let r=execute(&p,"","CREATE TABLE trigger_target(value TEXT); CREATE TABLE trigger_log(value TEXT); CREATE TRIGGER log_insert AFTER INSERT ON trigger_target BEGIN INSERT INTO trigger_log VALUES ('before;'); INSERT INTO trigger_log VALUES (NEW.value); END; INSERT INTO trigger_target VALUES ('after;'); SELECT COUNT(*) FROM trigger_log;",flag()).await.unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results.last().unwrap().rows[0][0], json!("2"));
        assert!(!db::tables(&p, "")
            .await
            .unwrap()
            .iter()
            .any(|t| t.name == "write_test"));
    }
    #[tokio::test]
    async fn sqlite_returning_is_drained_and_explicit_transactions_are_run_scoped() {
        let file = Fixture(
            std::env::temp_dir().join(format!("dum-e-write-{}.sqlite", uuid::Uuid::new_v4())),
        );
        db::demo_file(&file.0).await.unwrap();
        let p = sqlite_profile(&file.0);
        let r=execute(&p,"","CREATE TABLE changes(id INTEGER PRIMARY KEY); WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<500) INSERT INTO changes SELECT x FROM n RETURNING id; SELECT COUNT(*) AS total FROM changes;",flag()).await.unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results[1].rows.len(), 200);
        assert!(r.results[1].truncated);
        assert_eq!(r.results[2].rows[0][0], json!("500"));
        assert_eq!(r.results[2].columns[0].data_type, "INTEGER");
        let r = execute(
            &p,
            "",
            "BEGIN; DELETE FROM changes; ROLLBACK; SELECT COUNT(*) FROM changes;",
            flag(),
        )
        .await
        .unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results.last().unwrap().rows[0][0], json!("500"));
        let r = execute(&p, "", "BEGIN; DELETE FROM changes;", flag())
            .await
            .unwrap();
        assert!(r.error.is_none());
        let count = db::query(&p, "", "SELECT COUNT(*) FROM changes", flag())
            .await
            .unwrap();
        assert_eq!(count.rows[0][0], json!("500"));
        let r=execute(&p,"","INSERT INTO changes VALUES(501); INSERT INTO missing_table VALUES(1); INSERT INTO changes VALUES(502);",flag()).await.unwrap();
        assert!(r.error.is_some());
        assert_eq!(r.results.len(), 1);
        let count = db::query(&p, "", "SELECT COUNT(*) FROM changes", flag())
            .await
            .unwrap();
        assert_eq!(count.rows[0][0], json!("501")); // SQLite autocommit: earlier write persists.
    }
    #[tokio::test]
    #[ignore = "requires isolated PostgreSQL; set DUM_E_TEST_PG_PORT"]
    async fn postgres_real_full_sql_scripts_and_rollback() {
        let p = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Write fixture".into(),
            driver: "postgres".into(),
            host: "127.0.0.1".into(),
            port: std::env::var("DUM_E_TEST_PG_PORT")
                .unwrap()
                .parse()
                .unwrap(),
            database: "postgres".into(),
            username: "postgres".into(),
            path: String::new(),
            tls: false,
            remember_password: false,
        };
        let password = "dum-e-local-test-only";
        let fidelity = execute(&p, password,
            r#"SELECT 'null'::json, NULL::json, '{"id":9007199254740993,"id":9007199254740994}'::json, '{"exact":1234567890.123456789}'::jsonb"#,
            flag()).await.unwrap();
        assert!(fidelity.error.is_none(), "{:?}", fidelity.error);
        let raw = &fidelity.results[0].json_raw[&0];
        assert_eq!(raw[&0], "null");
        assert!(!raw.contains_key(&1));
        assert_eq!(raw[&2], r#"{"id":9007199254740993,"id":9007199254740994}"#);
        assert!(raw[&3].contains("1234567890.123456789"));

        let setup=execute(&p,password,"CREATE SCHEMA overview_external; CREATE TABLE overview_external.link(child_id bigint REFERENCES catalog_test.child(id));",flag()).await.unwrap();
        assert!(setup.error.is_none(), "{:?}", setup.error);
        let overview = crate::relations::inspect(&p, password).await.unwrap();
        assert!(overview
            .relations
            .iter()
            .any(|r| r.from_table.schema == "overview_external"
                && r.to_table.schema == "catalog_test"));
        assert!(overview
            .tables
            .iter()
            .any(|t| t.name == "child_materialized"));
        assert!(overview
            .relations
            .iter()
            .any(|r| r.from_table.schema == "catalog_test" && r.columns.len() == 2));
        assert_eq!(
            overview
                .relations
                .iter()
                .map(|r| r.id.clone())
                .collect::<std::collections::HashSet<_>>()
                .len(),
            overview.relations.len()
        );
        let empty_schema = execute(&p, password, "CREATE SCHEMA empty_menu_fixture;", flag())
            .await
            .unwrap();
        assert!(empty_schema.error.is_none());
        assert!(db::schemas(&p, password)
            .await
            .unwrap()
            .contains(&"empty_menu_fixture".into()));
        let empty_schema=execute(&p,password,"ALTER SCHEMA empty_menu_fixture RENAME TO renamed_menu_fixture; DROP SCHEMA renamed_menu_fixture RESTRICT;",flag()).await.unwrap();
        assert!(empty_schema.error.is_none(), "{:?}", empty_schema.error);
        assert!(!db::schemas(&p, password)
            .await
            .unwrap()
            .contains(&"renamed_menu_fixture".into()));
        let r=execute(&p,password,"CREATE SCHEMA write_test; CREATE TABLE write_test.items(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text); INSERT INTO write_test.items(name) SELECT 'item;' || n FROM generate_series(1,500) n RETURNING id,name; SELECT COUNT(*) AS total FROM write_test.items;",flag()).await.unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results.len(), 4);
        assert_eq!(r.results[2].affected_rows, Some(500));
        assert_eq!(r.results[2].rows.len(), 200);
        assert!(r.results[2].truncated);
        assert_eq!(r.results[3].rows[0][0], json!("500"));
        let r=execute(&p,password,"UPDATE write_test.items SET name='updated' WHERE id=1 RETURNING id,name; DELETE FROM write_test.items WHERE id=2; ALTER TABLE write_test.items ADD COLUMN active boolean DEFAULT true;",flag()).await.unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results[0].rows[0][1], json!("updated"));
        let r=execute(&p,password,"INSERT INTO write_test.items(name) VALUES ('rolled back'); SELECT * FROM missing_table;",flag()).await.unwrap();
        assert!(r.error.is_some());
        let count = db::query(
            &p,
            password,
            "SELECT COUNT(*) FROM write_test.items",
            flag(),
        )
        .await
        .unwrap();
        assert_eq!(count.rows[0][0], json!("499")); // PG simple-query script is implicitly atomic.
        let r = execute(
            &p,
            password,
            "BEGIN; DELETE FROM write_test.items; ROLLBACK; SELECT COUNT(*) FROM write_test.items;",
            flag(),
        )
        .await
        .unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results.last().unwrap().rows[0][0], json!("499"));
        let r=execute(&p,password,"CREATE FUNCTION write_test.echo(value text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN value || ';suffix'; END; $$; SELECT write_test.echo('hello') AS value;",flag()).await.unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results.last().unwrap().rows[0][0], json!("hello;suffix"));
        let r=execute(&p,password,"CREATE ROLE dum_e_restricted LOGIN PASSWORD 'dum-e-restricted-test-only'; GRANT USAGE ON SCHEMA write_test TO dum_e_restricted; GRANT SELECT ON write_test.items TO dum_e_restricted;",flag()).await.unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        let mut reader = p.clone();
        reader.username = "dum_e_restricted".into();
        reader.id = uuid::Uuid::new_v4().to_string();
        let overview = crate::relations::inspect(&reader, "dum-e-restricted-test-only")
            .await
            .unwrap();
        assert!(overview.tables.iter().all(|t| t.schema != "catalog_test"));
        assert!(overview
            .relations
            .iter()
            .all(|r| r.from_table.schema != "catalog_test" && r.to_table.schema != "catalog_test"));
        let r = execute(
            &reader,
            "dum-e-restricted-test-only",
            "SELECT COUNT(*) FROM write_test.items;",
            flag(),
        )
        .await
        .unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results[0].rows[0][0], json!("499"));
        for sql in [
            "INSERT INTO write_test.items(name) VALUES ('denied');",
            "CREATE TABLE write_test.denied(id int);",
            "DROP TABLE write_test.items;",
        ] {
            let r = execute(&reader, "dum-e-restricted-test-only", sql, flag())
                .await
                .unwrap();
            let error = r
                .error
                .expect("restricted login must not write or own objects");
            assert!(
                error.contains("dum_e_restricted") && error.contains("permission"),
                "{error}"
            );
        }
        let r = execute(&p, password, "DROP SCHEMA write_test CASCADE;", flag())
            .await
            .unwrap();
        assert!(r.error.is_none());
    }
}
