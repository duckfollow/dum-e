//! One database-wide catalog read, independent of table detail requests.
use crate::{
    db::{self, Profile, Table},
    metadata::{action, object, ColumnPair, Relation},
};
use serde::Serialize;
use sqlx::{Executor, Row};
use std::{
    collections::{BTreeMap, HashSet},
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRelations {
    pub tables: Vec<Table>,
    pub relations: Vec<Relation>,
    pub notes: Vec<String>,
}
fn error(e: sqlx::Error) -> String {
    e.to_string()
}
pub async fn inspect(profile: &Profile, password: &str) -> Result<DatabaseRelations, String> {
    let result = tokio::time::timeout(Duration::from_secs(20), load(profile, password))
        .await
        .map_err(|_| "Database relation overview timed out".to_string())??;
    if serde_json::to_vec(&result)
        .map_err(|e| e.to_string())?
        .len()
        > 8 * 1024 * 1024
    {
        return Err("Database relation metadata exceeds the 8 MB limit".into());
    }
    Ok(result)
}
async fn load(profile: &Profile, password: &str) -> Result<DatabaseRelations, String> {
    let tables = db::tables(profile, password).await?;
    if tables.len() > 2000 {
        return Err("Database overview supports up to 2,000 visible objects. No partial catalog was returned.".into());
    }
    let relations = if profile.driver == "sqlite" {
        sqlite(profile).await?
    } else {
        postgres(profile, password).await?
    };
    let relations = if profile.driver == "postgres" {
        let visible: HashSet<_> = tables
            .iter()
            .map(|t| (t.schema.clone(), t.name.clone()))
            .collect();
        relations
            .into_iter()
            .filter(|r| {
                visible.contains(&(r.from_table.schema.clone(), r.from_table.name.clone()))
                    && visible.contains(&(r.to_table.schema.clone(), r.to_table.name.clone()))
            })
            .collect()
    } else {
        relations
    };
    Ok(DatabaseRelations{tables,relations,notes:vec!["Only declared foreign keys are shown. Arrows point from the referencing table to its referenced table. Views and tables without foreign keys are included as isolated objects.".into(),"The overview is a snapshot of objects visible to this connection. Refresh after schema changes. PostgreSQL links require both objects to be visible; privileges are not expanded.".into()]})
}
async fn postgres(profile: &Profile, password: &str) -> Result<Vec<Relation>, String> {
    let mut c = db::postgres(profile, password).await?;
    c.execute("BEGIN READ ONLY").await.map_err(error)?;
    let rows=sqlx::query(r#"SELECT x.oid::text AS id,x.conname::text AS name,sn.nspname::text AS source_schema,s.relname::text AS source_table,tn.nspname::text AS target_schema,t.relname::text AS target_table,x.confupdtype::text AS on_update,x.confdeltype::text AS on_delete,x.convalidated AS validated,x.condeferrable AS deferrable,ARRAY(SELECT a.attname::text FROM unnest(x.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=x.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS source_columns,ARRAY(SELECT a.attname::text FROM unnest(x.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=x.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS target_columns FROM pg_constraint x JOIN pg_class s ON s.oid=x.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace JOIN pg_class t ON t.oid=x.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace WHERE x.contype='f' AND sn.nspname NOT LIKE 'pg_%' AND tn.nspname NOT LIKE 'pg_%' AND (pg_has_role(s.relowner,'USAGE') OR has_table_privilege(s.oid,'SELECT') OR has_any_column_privilege(s.oid,'SELECT')) AND (pg_has_role(t.relowner,'USAGE') OR has_table_privilege(t.oid,'SELECT') OR has_any_column_privilege(t.oid,'SELECT')) ORDER BY sn.nspname,s.relname,x.conname LIMIT 10001"#).fetch_all(&mut c).await.map_err(error)?;
    if rows.len() > 10000 {
        return Err("Relationship metadata exceeds 10,000 foreign keys".into());
    }
    let relations: Vec<Relation> = rows
        .iter()
        .map(|r| {
            let from: Vec<String> = r.get("source_columns");
            let to: Vec<String> = r.get("target_columns");
            Relation {
                id: r.get("id"),
                name: Some(r.get("name")),
                from_table: object(
                    r.get::<String, _>("source_schema").as_str(),
                    r.get::<String, _>("source_table").as_str(),
                ),
                to_table: object(
                    r.get::<String, _>("target_schema").as_str(),
                    r.get::<String, _>("target_table").as_str(),
                ),
                columns: from
                    .into_iter()
                    .zip(to)
                    .map(|(from, to)| ColumnPair { from, to: Some(to) })
                    .collect(),
                on_update: action(&r.get::<String, _>("on_update")),
                on_delete: action(&r.get::<String, _>("on_delete")),
                validated: Some(r.get("validated")),
                deferrable: Some(r.get("deferrable")),
            }
        })
        .collect();
    Ok(relations)
}
async fn sqlite(profile: &Profile) -> Result<Vec<Relation>, String> {
    let mut c = db::sqlite(profile, Arc::new(AtomicBool::new(false))).await?;
    c.execute("BEGIN").await.map_err(error)?;
    let names:Vec<String>=sqlx::query_scalar("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetch_all(&mut c).await.map_err(error)?;
    if names.len() > 2000 {
        return Err("Database overview supports up to 2,000 SQLite tables".into());
    }
    let rows=sqlx::query(r#"SELECT m.name AS source_table,f.id,f.seq,f."table" AS target_table,f."from" AS source_column,f."to" AS target_column,f.on_update,f.on_delete FROM sqlite_schema m JOIN pragma_foreign_key_list(m.name) f WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name,f.id,f.seq LIMIT 10001"#).fetch_all(&mut c).await.map_err(error)?;
    if rows.len() > 10000 {
        return Err("Database relation metadata exceeds 10,000 SQLite FK column pairs".into());
    }
    let pk_rows=sqlx::query("SELECT m.name AS table_name,p.name AS column_name,p.pk FROM sqlite_schema m JOIN pragma_table_xinfo(m.name) p WHERE m.type='table' AND p.pk>0 ORDER BY m.name,p.pk LIMIT 100001").fetch_all(&mut c).await.map_err(error)?;
    if pk_rows.len() > 100000 {
        return Err("Database primary key metadata exceeds the preview limit".into());
    }
    let mut pks: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in pk_rows {
        pks.entry(row.get("table_name"))
            .or_default()
            .push(row.get("column_name"));
    }
    let mut relations: BTreeMap<(String, i64), Relation> = BTreeMap::new();
    for row in rows {
        let source: String = row.get("source_table");
        let raw: String = row.get("target_table");
        let target = names
            .iter()
            .find(|n| n.eq_ignore_ascii_case(&raw))
            .cloned()
            .unwrap_or(raw);
        let id: i64 = row.get("id");
        let r = relations
            .entry((source.clone(), id))
            .or_insert_with(|| Relation {
                id: format!("sqlite:{source}:{id}"),
                name: None,
                from_table: object("main", &source),
                to_table: object("main", &target),
                columns: vec![],
                on_update: row.get("on_update"),
                on_delete: row.get("on_delete"),
                validated: None,
                deferrable: None,
            });
        r.columns.push(ColumnPair {
            from: row.get("source_column"),
            to: row.get("target_column"),
        });
    }
    for r in relations.values_mut() {
        if let Some(pk) = pks.get(&r.to_table.name) {
            if pk.len() == r.columns.len() {
                for (pair, name) in r.columns.iter_mut().zip(pk) {
                    if pair.to.is_none() {
                        pair.to = Some(name.clone());
                    }
                }
            }
        }
    }
    Ok(relations.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn sqlite_database_overview_includes_isolated_composite_and_self_links() {
        let path =
            std::env::temp_dir().join(format!("dum-e-overview-{}.sqlite", uuid::Uuid::new_v4()));
        db::demo_file(&path).await.unwrap();
        let p = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Overview fixture".into(),
            driver: "sqlite".into(),
            path: path.to_string_lossy().into(),
            host: String::new(),
            port: 5432,
            database: String::new(),
            username: String::new(),
            tls: true,
            remember_password: false,
        };
        let data = inspect(&p, "").await.unwrap();
        assert_eq!(data.tables.len(), 7);
        assert!(data.tables.iter().any(|t| t.name == "equipment"));
        assert_eq!(data.relations.len(), 4);
        let pair = data
            .relations
            .iter()
            .find(|r| {
                r.from_table.name == "mission_events" && r.to_table.name == "mission_assignments"
            })
            .unwrap();
        assert_eq!(pair.columns.len(), 2);
        assert!(data
            .relations
            .iter()
            .any(|r| r.from_table.name == "mission_events" && r.to_table.name == "mission_events"));
        let mut c = db::sqlite_mode(&p, Arc::new(AtomicBool::new(false)), true)
            .await
            .unwrap();
        c.execute("CREATE TABLE parent_implicit(b TEXT,a INTEGER,PRIMARY KEY(a,b)); CREATE TABLE child_implicit(x INTEGER,y TEXT, FOREIGN KEY(x,y) REFERENCES parent_implicit);").await.unwrap();
        let data = inspect(&p, "").await.unwrap();
        let fk = data
            .relations
            .iter()
            .find(|r| r.from_table.name == "child_implicit")
            .unwrap();
        assert_eq!(fk.columns[0].to.as_deref(), Some("a"));
        assert_eq!(fk.columns[1].to.as_deref(), Some("b"));
        drop(c);
        let _ = std::fs::remove_file(path);
    }
}
