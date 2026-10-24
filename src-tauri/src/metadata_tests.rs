use super::*;
use sqlx::{ConnectOptions, Connection};
struct Fixture {
    path: std::path::PathBuf,
    profile: Profile,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
async fn fixture(sql: &str) -> Fixture {
    let path = std::env::temp_dir().join(format!("dum-e-metadata-{}.sqlite", uuid::Uuid::new_v4()));
    let mut c = sqlx::SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .disable_statement_logging(),
    )
    .await
    .unwrap();
    c.execute(sql).await.unwrap();
    c.close().await.unwrap();
    let profile = Profile {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Isolated metadata".into(),
        driver: "sqlite".into(),
        path: path.to_string_lossy().into(),
        host: String::new(),
        port: 5432,
        database: String::new(),
        username: String::new(),
        tls: true,
        remember_password: false,
    };
    Fixture { path, profile }
}
#[tokio::test]
async fn sqlite_catalog_preserves_composite_and_self_relations_and_indexes() {
    let f=fixture(r#"
 CREATE TABLE "Parent" (tenant TEXT NOT NULL, code INTEGER NOT NULL, label TEXT DEFAULT 'new', PRIMARY KEY(code,tenant)) WITHOUT ROWID;
 CREATE TABLE child(id INTEGER PRIMARY KEY, tenant TEXT, parent_code INT, self_parent INT REFERENCES child(id), name TEXT UNIQUE, computed TEXT GENERATED ALWAYS AS (upper(name)) STORED, FOREIGN KEY(parent_code,tenant) REFERENCES parent ON UPDATE CASCADE ON DELETE SET NULL);
 CREATE INDEX idx_partial ON child(lower(name),parent_code DESC) WHERE parent_code IS NOT NULL;
 CREATE VIEW v_child AS SELECT id,name FROM child;
 "#).await;
    let child = inspect(&f.profile, "", &object("main", "child"))
        .await
        .unwrap();
    assert_eq!(child.rowid_alias.as_deref(), Some("id"));
    assert!(!child.columns[0].nullable);
    assert_eq!(
        child
            .columns
            .iter()
            .find(|c| c.name == "computed")
            .unwrap()
            .generated
            .as_deref(),
        Some("STORED")
    );
    let fk = child
        .relations
        .iter()
        .find(|r| r.to_table.name == "Parent")
        .unwrap();
    assert_eq!(fk.columns.len(), 2);
    assert_eq!(fk.columns[0].from, "parent_code");
    assert_eq!(fk.columns[0].to.as_deref(), Some("code"));
    assert_eq!(fk.columns[1].to.as_deref(), Some("tenant"));
    assert_eq!(fk.on_delete, "SET NULL");
    assert_eq!(fk.on_update, "CASCADE");
    assert!(fk.deferrable.is_none());
    assert_eq!(
        child
            .relations
            .iter()
            .filter(|r| r.from_table.name == r.to_table.name)
            .count(),
        1
    );
    assert!(child.constraints.iter().any(|c| c.kind == "UNIQUE"));
    assert_eq!(
        child
            .constraints
            .iter()
            .filter(|c| c.kind == "FOREIGN KEY")
            .count(),
        2
    );
    let index = child
        .indexes
        .iter()
        .find(|i| i.name == "idx_partial")
        .unwrap();
    assert!(index.predicate.is_some());
    assert!(index.definition.as_ref().unwrap().contains("lower(name)"));
    assert_eq!(index.parts[1].descending, Some(true));
    assert!(index.parts.iter().any(|p| p.role == "auxiliary"));
    let parent = inspect(&f.profile, "", &object("main", "Parent"))
        .await
        .unwrap();
    assert_eq!(parent.without_rowid, Some(true));
    assert!(parent
        .relations
        .iter()
        .any(|r| r.from_table.name == "child"));
    assert_eq!(parent.columns[1].primary_key_position, 1);
    assert_eq!(parent.columns[0].primary_key_position, 2);
    let view = inspect(&f.profile, "", &object("main", "v_child"))
        .await
        .unwrap();
    assert_eq!(view.table.kind, "view");
    assert_eq!(view.columns.len(), 2);
    assert!(view.without_rowid.is_none());
    assert!(view.definition.unwrap().contains("CREATE VIEW"));
}
#[tokio::test]
async fn sqlite_nullability_strict_and_untrusted_names_are_reported_accurately() {
    let f=fixture(r#"CREATE TABLE legacy(k TEXT PRIMARY KEY); CREATE TABLE typed(k TEXT PRIMARY KEY,v ANY) STRICT; CREATE TABLE descending_pk(k INTEGER PRIMARY KEY DESC); CREATE TABLE "quote""table"("quote""column" TEXT DEFAULT 'hello');"#).await;
    let legacy = inspect(&f.profile, "", &object("main", "legacy"))
        .await
        .unwrap();
    assert!(legacy.columns[0].nullable);
    let typed = inspect(&f.profile, "", &object("main", "typed"))
        .await
        .unwrap();
    assert!(!typed.columns[0].nullable);
    assert_eq!(typed.strict, Some(true));
    assert_eq!(
        typed.columns[1].type_detail.as_deref(),
        Some("ANY (STRICT)")
    );
    let descending = inspect(&f.profile, "", &object("main", "descending_pk"))
        .await
        .unwrap();
    assert!(descending.rowid_alias.is_none());
    assert!(descending.columns[0].nullable);
    let quoted = inspect(&f.profile, "", &object("main", "quote\"table"))
        .await
        .unwrap();
    assert_eq!(quoted.columns[0].name, "quote\"column");
    assert_eq!(quoted.columns[0].default_value.as_deref(), Some("'hello'"));
    assert!(
        inspect(&f.profile, "", &object("main", "'; DROP TABLE legacy;--"))
            .await
            .is_err()
    );
    assert!(inspect(&f.profile, "", &object("temp", "legacy"))
        .await
        .is_err());
    assert!(inspect(&f.profile, "", &object("main", "legacy"))
        .await
        .is_ok());
}
#[tokio::test]
#[ignore = "requires isolated PostgreSQL; set DUM_E_TEST_PG_PORT"]
async fn postgres_real_metadata() {
    let port = std::env::var("DUM_E_TEST_PG_PORT")
        .expect("isolated test port")
        .parse()
        .unwrap();
    let profile = Profile {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Isolated metadata".into(),
        driver: "postgres".into(),
        host: "127.0.0.1".into(),
        port,
        database: "postgres".into(),
        username: "postgres".into(),
        path: String::new(),
        tls: false,
        remember_password: false,
    };
    let details = inspect(
        &profile,
        "dum-e-local-test-only",
        &object("catalog_test", "child"),
    )
    .await
    .unwrap();
    assert_eq!(details.columns[0].identity.as_deref(), Some("ALWAYS"));
    assert!(!details.columns[0].nullable);
    let status = details.columns.iter().find(|c| c.name == "status").unwrap();
    assert_eq!(status.enum_values, vec!["queued", "done"]);
    assert_eq!(status.type_detail.as_deref(), Some("Enum"));
    assert_eq!(status.comment.as_deref(), Some("Workflow status"));
    let domain = details.columns.iter().find(|c| c.name == "code").unwrap();
    assert!(domain
        .type_detail
        .as_ref()
        .unwrap()
        .starts_with("Domain over"));
    assert_eq!(
        details
            .columns
            .iter()
            .find(|c| c.name == "computed")
            .unwrap()
            .generated
            .as_deref(),
        Some("STORED")
    );
    let relation = details
        .relations
        .iter()
        .find(|r| r.to_table.name == "parent")
        .unwrap();
    assert_eq!(relation.columns[0].from, "parent_code");
    assert_eq!(relation.columns[0].to.as_deref(), Some("code"));
    assert_eq!(relation.columns[1].to.as_deref(), Some("tenant"));
    assert_eq!(relation.on_delete, "CASCADE");
    assert_eq!(relation.deferrable, Some(true));
    let index = details
        .indexes
        .iter()
        .find(|i| i.name == "child_expression_partial")
        .unwrap();
    assert!(index.predicate.as_ref().unwrap().contains("parent_code"));
    assert!(index.parts[0].expression.contains("lower"));
    assert_eq!(index.parts.last().unwrap().role, "included");
    assert!(details.constraints.iter().any(|c| c.kind == "CHECK"));
    assert!(details
        .definition
        .as_ref()
        .unwrap()
        .contains("GENERATED ALWAYS AS IDENTITY"));
    let parent = inspect(
        &profile,
        "dum-e-local-test-only",
        &object("catalog_test", "parent"),
    )
    .await
    .unwrap();
    assert!(parent
        .relations
        .iter()
        .any(|r| r.from_table.name == "child"));
    assert!(parent.columns.iter().any(|c| c.primary_key_position == 2));
    let quoted = inspect(
        &profile,
        "dum-e-local-test-only",
        &object("catalog_test", "odd\"table"),
    )
    .await
    .unwrap();
    assert_eq!(quoted.columns[0].name, "odd\"column");
    let view = inspect(
        &profile,
        "dum-e-local-test-only",
        &object("catalog_test", "child_view"),
    )
    .await
    .unwrap();
    assert_eq!(view.table.kind, "view");
    assert!(view.definition.unwrap().contains("CREATE VIEW"));
    assert!(inspect(
        &profile,
        "dum-e-local-test-only",
        &object("catalog_test", "missing")
    )
    .await
    .is_err());
}
