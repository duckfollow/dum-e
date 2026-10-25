//! Staged cell updates. Each row is checked under lock before writing; transaction drop rolls back.
use crate::{
    db::{self, Profile, Table},
    metadata::{self, TableDetails},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Connection, Row};
use std::{
    collections::{BTreeMap, HashSet},
    sync::{atomic::AtomicBool, Arc},
};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EditOperation {
    #[default]
    Update,
    Insert,
    Delete,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowEdit {
    #[serde(default)]
    pub operation: EditOperation,
    #[serde(default)]
    pub original: Vec<Value>,
    #[serde(default)]
    pub changes: BTreeMap<String, Value>,
}
fn err(e: sqlx::Error) -> String {
    e.to_string()
}
const CONFLICT: &str = "A row changed or was deleted. Nothing was saved. Discard changes and reload before editing again.";
fn scalar(v: &Value) -> bool {
    v.is_null() || v.is_string() || v.is_boolean() || v.is_number()
}
pub fn editable_type(t: &str) -> bool {
    let t = t.to_lowercase();
    [
        "text",
        "character varying",
        "character",
        "varchar",
        "char",
        "integer",
        "int",
        "int2",
        "int4",
        "int8",
        "smallint",
        "bigint",
        "real",
        "double precision",
        "float",
        "float4",
        "float8",
        "numeric",
        "decimal",
        "boolean",
        "bool",
    ]
    .iter()
    .any(|base| t == *base || t.starts_with(&format!("{base}(")))
}
fn validate(details: &TableDetails, edits: &[RowEdit]) -> Result<Vec<usize>, String> {
    if details.table.kind != "table" {
        return Err("Only ordinary tables can be edited.".into());
    }
    let keys: Vec<_> = details
        .columns
        .iter()
        .enumerate()
        .filter_map(|(i, c)| (c.primary_key_position > 0).then_some(i))
        .collect();
    if keys.is_empty() {
        return Err("A primary key is required to edit rows.".into());
    }
    let mut seen = HashSet::new();
    for edit in edits {
        if edit.operation != EditOperation::Insert {
            if edit.original.len() != details.columns.len()
                || edit.original.iter().any(|v| !scalar(v))
                || details
                    .columns
                    .iter()
                    .any(|c| matches!(c.data_type.as_str(), "json" | "jsonb"))
            {
                return Err(
                    "Reload this table. Rows containing JSON or binary previews are read-only."
                        .into(),
                );
            }
            let key: Vec<_> = keys.iter().map(|i| &edit.original[*i]).collect();
            if key.iter().any(|v| v.is_null())
                || !seen.insert(serde_json::to_string(&key).map_err(|e| e.to_string())?)
            {
                return Err("Rows require distinct, non-NULL primary keys.".into());
            }
        } else if !edit.original.is_empty() {
            return Err("New rows must not include original values.".into());
        }
        if edit.operation == EditOperation::Update && edit.changes.is_empty() {
            return Err("No changes supplied for a row.".into());
        }
        if edit.operation == EditOperation::Delete && !edit.changes.is_empty() {
            return Err("Deleted rows cannot include changes.".into());
        }
        for (name, value) in &edit.changes {
            let c = details
                .columns
                .iter()
                .find(|c| c.name == *name)
                .ok_or("Unknown column. Reload the table.")?;
            if c.generated.is_some()
                || c.identity.is_some()
                || !editable_type(&c.data_type)
                || !scalar(value)
                || (value.is_null() && !c.nullable)
            {
                return Err(format!(
                    "Column '{name}' is read-only or the value is invalid."
                ));
            }
            if [
                "integer", "int", "smallint", "bigint", "int2", "int4", "int8",
            ]
            .contains(&c.data_type.to_lowercase().as_str())
                && !value.is_null()
            {
                let text = value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string());
                text.parse::<i64>()
                    .map_err(|_| "Enter a whole number within the signed 64-bit range.")?;
            }
            if value.to_string().len() > 65536 {
                return Err("A cell exceeds 64 KB.".into());
            }
        }
    }
    Ok(keys)
}
fn json_row(details: &TableDetails, values: &[Value]) -> Value {
    Value::Object(
        details
            .columns
            .iter()
            .zip(values)
            .map(|(c, v)| (c.name.clone(), v.clone()))
            .collect(),
    )
}
fn bind_sqlite<'q>(
    mut q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    v: &'q Value,
) -> Result<sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, String> {
    q = match v {
        Value::Null => q.bind(None::<String>),
        Value::String(s) => q.bind(s.as_str()),
        Value::Bool(b) => q.bind(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else {
                q.bind(n.as_f64().ok_or("Invalid number")?)
            }
        }
        _ => return Err("Unsupported cell value".into()),
    };
    Ok(q)
}
pub async fn apply(
    profile: &Profile,
    password: &str,
    table: &Table,
    edits: &[RowEdit],
) -> Result<u64, String> {
    if edits.is_empty()
        || edits.len() > 200
        || serde_json::to_vec(&edits_as_value(edits))
            .map_err(|e| e.to_string())?
            .len()
            > 8 * 1024 * 1024
    {
        return Err("Apply between 1 and 200 rows, up to 8 MB.".into());
    }
    let target = format!("{}.{}", db::quoted(&table.schema), db::quoted(&table.name));
    if profile.driver == "sqlite" {
        let mut c = db::sqlite_mode(profile, Arc::new(AtomicBool::new(false)), true).await?;
        sqlx::query("PRAGMA foreign_keys=ON")
            .execute(&mut c)
            .await
            .map_err(err)?;
        let mut tx = c.begin_with("BEGIN IMMEDIATE").await.map_err(err)?;
        let details = metadata::inspect(profile, password, table).await?;
        let keys = validate(&details, edits)?;
        // Reject virtual tables, whose update modules can have external effects.
        if details
            .definition
            .as_deref()
            .unwrap_or("")
            .to_uppercase()
            .contains("CREATE VIRTUAL TABLE")
        {
            return Err("Virtual tables are read-only.".into());
        }
        let predicate = keys
            .iter()
            .map(|i| format!("{} IS ?", db::quoted(&details.columns[*i].name)))
            .collect::<Vec<_>>()
            .join(" AND ");
        let select = format!("SELECT * FROM {target} WHERE {predicate}");
        for edit in edits
            .iter()
            .filter(|e| e.operation != EditOperation::Insert)
        {
            let mut q = sqlx::query(&select);
            for i in &keys {
                q = bind_sqlite(q, &edit.original[*i])?;
            }
            let rows = q.fetch_all(&mut *tx).await.map_err(err)?;
            if rows.len() != 1 {
                return Err(CONFLICT.into());
            }
            let current = (0..rows[0].len())
                .map(|i| db::sqlite_cell(&rows[0], i))
                .collect::<Result<Vec<_>, _>>()?;
            if current != edit.original {
                return Err(CONFLICT.into());
            }
            if edit.operation == EditOperation::Delete {
                let sql = format!("DELETE FROM {target} WHERE {predicate}");
                let mut q = sqlx::query(&sql);
                for i in &keys {
                    q = bind_sqlite(q, &edit.original[*i])?;
                }
                if q.execute(&mut *tx).await.map_err(err)?.rows_affected() != 1 {
                    return Err(CONFLICT.into());
                }
                continue;
            }
            let set = edit
                .changes
                .keys()
                .map(|n| format!("{}=?", db::quoted(n)))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!("UPDATE {target} SET {set} WHERE {predicate}");
            let mut q = sqlx::query(&sql);
            for v in edit.changes.values() {
                q = bind_sqlite(q, v)?;
            }
            for i in &keys {
                q = bind_sqlite(q, &edit.original[*i])?;
            }
            if q.execute(&mut *tx).await.map_err(err)?.rows_affected() != 1 {
                return Err(CONFLICT.into());
            }
        }
        for edit in edits
            .iter()
            .filter(|e| e.operation == EditOperation::Insert)
        {
            let names = edit
                .changes
                .keys()
                .map(|n| db::quoted(n))
                .collect::<Vec<_>>()
                .join(",");
            let values = vec!["?"; edit.changes.len()].join(",");
            let sql = if edit.changes.is_empty() {
                format!("INSERT INTO {target} DEFAULT VALUES")
            } else {
                format!("INSERT INTO {target} ({names}) VALUES ({values})")
            };
            let mut q = sqlx::query(&sql);
            for value in edit.changes.values() {
                q = bind_sqlite(q, value)?;
            }
            if q.execute(&mut *tx).await.map_err(err)?.rows_affected() != 1 {
                return Err("New row was not inserted. Nothing was saved.".into());
            }
        }
        tx.commit().await.map_err(err)?;
    } else {
        let mut c = db::postgres_mode(profile, password, true).await?;
        let mut tx = c.begin().await.map_err(err)?;
        let kind: Option<String> = sqlx::query_scalar("SELECT c.relkind::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2").bind(&table.schema).bind(&table.name).fetch_optional(&mut *tx).await.map_err(err)?;
        if !matches!(kind.as_deref(), Some("r") | Some("p")) {
            return Err("Only ordinary tables can be edited.".into());
        }
        // Keep catalog and row shape stable while checking and updating; also serializes competing Applies.
        sqlx::query(&format!("LOCK TABLE {target} IN SHARE ROW EXCLUSIVE MODE"))
            .execute(&mut *tx)
            .await
            .map_err(err)?;
        let details = metadata::inspect(profile, password, table).await?;
        let keys = validate(&details, edits)?;
        let predicate = keys
            .iter()
            .map(|i| {
                let n = db::quoted(&details.columns[*i].name);
                format!("t.{n} IS NOT DISTINCT FROM o.{n}")
            })
            .collect::<Vec<_>>()
            .join(" AND ");
        let select = format!("SELECT t.* FROM {target} t, jsonb_populate_record(NULL::{target}, $1::jsonb) o WHERE {predicate} FOR UPDATE OF t");
        for edit in edits
            .iter()
            .filter(|e| e.operation != EditOperation::Insert)
        {
            let rows = sqlx::query(&select)
                .bind(json_row(&details, &edit.original))
                .fetch_all(&mut *tx)
                .await
                .map_err(err)?;
            if rows.len() != 1 {
                return Err(CONFLICT.into());
            }
            let current = (0..rows[0].len())
                .map(|i| db::pg_cell(&rows[0], i))
                .collect::<Result<Vec<_>, _>>()?;
            if current != edit.original {
                return Err(CONFLICT.into());
            }
            if edit.operation == EditOperation::Delete {
                let sql=format!("DELETE FROM {target} t USING jsonb_populate_record(NULL::{target}, $1::jsonb) o WHERE {predicate}");
                if sqlx::query(&sql)
                    .bind(json_row(&details, &edit.original))
                    .execute(&mut *tx)
                    .await
                    .map_err(err)?
                    .rows_affected()
                    != 1
                {
                    return Err(CONFLICT.into());
                }
                continue;
            }
            let set = edit
                .changes
                .keys()
                .map(|n| {
                    let n = db::quoted(n);
                    format!("{n}=v.{n}")
                })
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!("UPDATE {target} t SET {set} FROM jsonb_populate_record(NULL::{target}, $1::jsonb) o, jsonb_populate_record(NULL::{target}, $2::jsonb) v WHERE {predicate}");
            let values = Value::Object(edit.changes.clone().into_iter().collect());
            if sqlx::query(&sql)
                .bind(json_row(&details, &edit.original))
                .bind(values)
                .execute(&mut *tx)
                .await
                .map_err(err)?
                .rows_affected()
                != 1
            {
                return Err(CONFLICT.into());
            }
        }
        for edit in edits
            .iter()
            .filter(|e| e.operation == EditOperation::Insert)
        {
            if edit.changes.is_empty() {
                if sqlx::query(&format!("INSERT INTO {target} DEFAULT VALUES"))
                    .execute(&mut *tx)
                    .await
                    .map_err(err)?
                    .rows_affected()
                    != 1
                {
                    return Err("New row was not inserted. Nothing was saved.".into());
                }
            } else {
                let names = edit
                    .changes
                    .keys()
                    .map(|n| db::quoted(n))
                    .collect::<Vec<_>>()
                    .join(",");
                let selected = edit
                    .changes
                    .keys()
                    .map(|n| format!("v.{}", db::quoted(n)))
                    .collect::<Vec<_>>()
                    .join(",");
                let sql=format!("INSERT INTO {target} ({names}) SELECT {selected} FROM jsonb_populate_record(NULL::{target}, $1::jsonb) v");
                let values = Value::Object(edit.changes.clone().into_iter().collect());
                if sqlx::query(&sql)
                    .bind(values)
                    .execute(&mut *tx)
                    .await
                    .map_err(err)?
                    .rows_affected()
                    != 1
                {
                    return Err("New row was not inserted. Nothing was saved.".into());
                }
            }
        }
        tx.commit().await.map_err(err)?;
    }
    Ok(edits.len() as u64)
}
fn edits_as_value(edits: &[RowEdit]) -> Vec<Value> {
    edits
        .iter()
        .map(|e| serde_json::json!({"operation":e.operation,"original":e.original,"changes":e.changes}))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution;
    use serde_json::json;
    struct Fixture(std::path::PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    fn flag() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }
    async fn sql(p: &Profile, password: &str, statement: &str) {
        let r = execution::execute(p, password, statement, flag())
            .await
            .unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
    }
    async fn rows(p: &Profile, password: &str, table: &Table) -> Vec<Vec<Value>> {
        db::query(
            p,
            password,
            &format!(
                "SELECT * FROM {}.{} ORDER BY 1,2",
                db::quoted(&table.schema),
                db::quoted(&table.name)
            ),
            flag(),
        )
        .await
        .unwrap()
        .rows
    }
    fn edit(row: &[Value], changes: Value) -> RowEdit {
        RowEdit {
            operation: EditOperation::Update,
            original: row.to_vec(),
            changes: serde_json::from_value(changes).unwrap(),
        }
    }
    async fn exercise(p: &Profile, password: &str, schema: &str) {
        let table = Table {
            schema: schema.into(),
            name: "edit\"items".into(),
            kind: "view".into(),
        }; // Client kind is never trusted.
        let target = format!("{}.{}", db::quoted(schema), db::quoted(&table.name));
        sql(p,password,&format!("CREATE TABLE {target}(a BIGINT, b TEXT, name TEXT NOT NULL CHECK(name <> 'bad'), active BOOLEAN, amount NUMERIC, computed BIGINT GENERATED ALWAYS AS (a+1) STORED, PRIMARY KEY(a,b)); INSERT INTO {target}(a,b,name,active,amount) VALUES (9007199254740993,'x','first',true,12.5),(2,'y','second',false,2);")).await;
        let initial = rows(p, password, &table).await;
        assert_eq!(
            apply(
                p,
                password,
                &table,
                &[
                    edit(
                        &initial[0],
                        json!({"name":"a'b; DROP TABLE nope; --","active":true,"amount":"19.25"})
                    ),
                    edit(&initial[1], json!({"active":null,"name":"changed"}))
                ]
            )
            .await
            .unwrap(),
            2
        );
        let current = rows(p, password, &table).await;
        assert_eq!(current[0][2], json!("a'b; DROP TABLE nope; --"));
        assert_eq!(current[1][3], Value::Null);
        assert_eq!(current[1][0], json!("9007199254740993"));
        // A conflict on the second row rolls back the first update.
        sql(
            p,
            password,
            &format!("UPDATE {target} SET name='someone else' WHERE a=9007199254740993"),
        )
        .await;
        let failure = apply(
            p,
            password,
            &table,
            &[
                edit(&current[0], json!({"name":"must rollback"})),
                edit(&current[1], json!({"name":"stale"})),
            ],
        )
        .await
        .unwrap_err();
        assert!(failure.contains("changed or was deleted"), "{failure}");
        let stable = rows(p, password, &table).await;
        assert_eq!(stable[0][2], current[0][2]);
        assert_eq!(stable[1][2], json!("someone else"));
        // A later CHECK failure also rolls back earlier updates.
        assert!(apply(
            p,
            password,
            &table,
            &[
                edit(&stable[0], json!({"name":"rollback"})),
                edit(&stable[1], json!({"name":"bad"}))
            ]
        )
        .await
        .is_err());
        assert_eq!(rows(p, password, &table).await, stable);
        assert!(apply(
            p,
            password,
            &table,
            &[edit(&stable[0], json!({"computed":"5"}))]
        )
        .await
        .is_err());
        assert!(apply(
            p,
            password,
            &table,
            &[edit(&stable[0], json!({"name":null}))]
        )
        .await
        .is_err());
        assert!(apply(
            p,
            password,
            &table,
            &[edit(&stable[0], json!({"a":"9223372036854775808"}))]
        )
        .await
        .is_err());
        assert!(apply(
            p,
            password,
            &table,
            &[
                edit(&stable[0], json!({"name":"one"})),
                edit(&stable[0], json!({"name":"two"}))
            ]
        )
        .await
        .is_err());
        // A missing row is a conflict, not a successful zero-row update.
        sql(
            p,
            password,
            &format!("DELETE FROM {target} WHERE a=9007199254740993"),
        )
        .await;
        assert!(apply(
            p,
            password,
            &table,
            &[edit(&stable[1], json!({"name":"deleted"}))]
        )
        .await
        .unwrap_err()
        .contains("changed or was deleted"));
        let no_key = Table {
            schema: schema.into(),
            name: "no_key".into(),
            kind: "table".into(),
        };
        sql(p,password,&format!("CREATE TABLE {}.no_key(name TEXT); INSERT INTO {}.no_key VALUES ('read only'); CREATE VIEW {}.edit_view AS SELECT * FROM {target};",db::quoted(schema),db::quoted(schema),db::quoted(schema))).await;
        assert!(apply(
            p,
            password,
            &no_key,
            &[edit(&[json!("read only")], json!({"name":"no"}))]
        )
        .await
        .unwrap_err()
        .contains("primary key"));
        let view = Table {
            schema: schema.into(),
            name: "edit_view".into(),
            kind: "table".into(),
        };
        assert!(apply(
            p,
            password,
            &view,
            &[edit(&stable[0], json!({"name":"no"}))]
        )
        .await
        .is_err());
    }
    async fn exercise_crud(p: &Profile, password: &str, schema: &str) {
        let table = Table {
            schema: schema.into(),
            name: "crud_items".into(),
            kind: "table".into(),
        };
        let target = format!("{}.{}", db::quoted(schema), db::quoted(&table.name));
        let id = if p.driver == "sqlite" {
            "INTEGER PRIMARY KEY"
        } else {
            "INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY"
        };
        sql(p,password,&format!("CREATE TABLE {target}(id {id},label TEXT NOT NULL DEFAULT 'new' CHECK(label <> 'bad'), active BOOLEAN DEFAULT true, computed INTEGER GENERATED ALWAYS AS (length(label)) STORED)")).await;
        let insert = |changes: Value| RowEdit {
            operation: EditOperation::Insert,
            original: vec![],
            changes: serde_json::from_value(changes).unwrap(),
        };
        let delete = |original: &Vec<Value>| RowEdit {
            operation: EditOperation::Delete,
            original: original.clone(),
            changes: BTreeMap::new(),
        };
        assert_eq!(
            apply(
                p,
                password,
                &table,
                &[
                    insert(json!({})),
                    insert(json!({"label":"quoted ' ; --", "active":null}))
                ]
            )
            .await
            .unwrap(),
            2
        );
        let before = rows(p, password, &table).await;
        assert_eq!(before.len(), 2);
        assert_eq!(before[0][1], json!("new"));
        assert_eq!(before[1][2], Value::Null);
        // All three operations commit together, respecting generated/default values.
        assert_eq!(
            apply(
                p,
                password,
                &table,
                &[
                    edit(&before[0], json!({"label":"updated"})),
                    delete(&before[1]),
                    insert(json!({"label":"created"}))
                ]
            )
            .await
            .unwrap(),
            3
        );
        let after = rows(p, password, &table).await;
        assert_eq!(after.len(), 2);
        assert_eq!(after[0][1], json!("updated"));
        assert_eq!(after[1][1], json!("created"));
        // A failed insert rolls back a preceding delete and update.
        assert!(apply(
            p,
            password,
            &table,
            &[
                edit(&after[0], json!({"label":"rollback"})),
                delete(&after[1]),
                insert(json!({"label":"bad"}))
            ]
        )
        .await
        .is_err());
        assert_eq!(rows(p, password, &table).await, after);
        let mut stale = after[1].clone();
        stale[1] = json!("stale");
        assert!(apply(
            p,
            password,
            &table,
            &[edit(&after[0], json!({"label":"rollback"})), delete(&stale)]
        )
        .await
        .unwrap_err()
        .contains("changed or was deleted"));
        assert_eq!(rows(p, password, &table).await, after);
        assert!(
            apply(p, password, &table, &[insert(json!({"computed":"4"}))])
                .await
                .is_err()
        );
        assert!(apply(p, password, &table, &[insert(json!({"label":null}))])
            .await
            .is_err());
        assert_eq!(
            apply(p, password, &table, &[delete(&after[0]), delete(&after[1])])
                .await
                .unwrap(),
            2
        );
        assert!(rows(p, password, &table).await.is_empty());
    }
    #[tokio::test]
    async fn sqlite_cell_edits_atomic_composite_conflict_and_constraints() {
        let file = Fixture(
            std::env::temp_dir().join(format!("dum-e-edit-{}.sqlite", uuid::Uuid::new_v4())),
        );
        std::fs::File::create(&file.0).unwrap();
        let p = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Editing fixture".into(),
            driver: "sqlite".into(),
            host: String::new(),
            port: 5432,
            database: String::new(),
            username: String::new(),
            path: file.0.to_string_lossy().into(),
            tls: true,
            remember_password: false,
        };
        exercise(&p, "", "main").await;
        exercise_crud(&p, "", "main").await;
        sql(&p,"","CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id)); INSERT INTO parent VALUES(1); INSERT INTO child VALUES(1,1);").await;
        let table = Table {
            schema: "main".into(),
            name: "child".into(),
            kind: "table".into(),
        };
        let before = rows(&p, "", &table).await;
        assert!(apply(
            &p,
            "",
            &table,
            &[edit(&before[0], json!({"parent_id":"2"}))]
        )
        .await
        .is_err());
        assert_eq!(rows(&p, "", &table).await, before);
    }
    #[tokio::test]
    #[ignore = "requires isolated PostgreSQL; run npm run test:postgres"]
    async fn postgres_real_cell_edits_atomic_composite_conflict_and_constraints() {
        let p = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Editing fixture".into(),
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
        let schema = format!("edit_{}", uuid::Uuid::new_v4().simple());
        sql(
            &p,
            "dum-e-local-test-only",
            &format!("CREATE SCHEMA {}", db::quoted(&schema)),
        )
        .await;
        exercise(&p, "dum-e-local-test-only", &schema).await;
        exercise_crud(&p, "dum-e-local-test-only", &schema).await;
        sql(&p,"dum-e-local-test-only",&format!("CREATE TABLE {}.json_items(id INTEGER PRIMARY KEY, name TEXT, payload JSONB); INSERT INTO {}.json_items VALUES (1,'before','null');",db::quoted(&schema),db::quoted(&schema))).await;
        let json_table = Table {
            schema: schema.clone(),
            name: "json_items".into(),
            kind: "table".into(),
        };
        let before = rows(&p, "dum-e-local-test-only", &json_table).await;
        assert!(apply(
            &p,
            "dum-e-local-test-only",
            &json_table,
            &[edit(&before[0], json!({"name":"after"}))]
        )
        .await
        .unwrap_err()
        .contains("JSON"));

        sql(
            &p,
            "dum-e-local-test-only",
            &format!("DROP SCHEMA {} CASCADE", db::quoted(&schema)),
        )
        .await;
    }
}
