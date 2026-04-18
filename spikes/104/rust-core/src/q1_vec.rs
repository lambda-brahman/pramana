// throwaway
//
// Q1: rusqlite (bundled SQLite) + sqlite-vec crate, statically linked, in-memory DB.
//   - register sqlite-vec via sqlite3_auto_extension
//   - create vec0 virtual table with dim=4
//   - insert 3 rows, run kNN via MATCH + k + distance column
//   - assert ordering matches hand-computed cosine

use anyhow::{Context, Result};
use rusqlite::ffi::sqlite3_auto_extension;
use rusqlite::{params, Connection};
use sqlite_vec::sqlite3_vec_init;
use zerocopy::AsBytes;

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    1.0 - dot / (na * nb + 1e-12)
}

type InitFn = unsafe extern "C" fn(
    *mut rusqlite::ffi::sqlite3,
    *mut *mut std::os::raw::c_char,
    *const rusqlite::ffi::sqlite3_api_routines,
) -> std::os::raw::c_int;

fn main() -> Result<()> {
    unsafe {
        let init: InitFn = std::mem::transmute(sqlite3_vec_init as *const ());
        sqlite3_auto_extension(Some(init));
    }

    let conn = Connection::open_in_memory().context("open_in_memory")?;

    let (vec_version, sqlite_version): (String, String) = conn.query_row(
        "SELECT vec_version(), sqlite_version()",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    println!("sqlite-version: {sqlite_version}");
    println!("sqlite-vec-version: {vec_version}");

    conn.execute_batch(
        "CREATE VIRTUAL TABLE vec_items USING vec0(embedding float[4]);",
    )?;

    let items: Vec<(i64, [f32; 4])> = vec![
        (1, [1.0, 0.0, 0.0, 0.0]),
        (2, [0.9, 0.1, 0.0, 0.0]),
        (3, [0.0, 1.0, 0.0, 0.0]),
    ];

    for (id, v) in &items {
        conn.execute(
            "INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)",
            params![id, v.as_bytes()],
        )?;
    }

    let query: [f32; 4] = [1.0, 0.05, 0.0, 0.0];
    let mut stmt = conn.prepare(
        "SELECT rowid, distance FROM vec_items
         WHERE embedding MATCH ? AND k = 3
         ORDER BY distance",
    )?;
    let rows: Vec<(i64, f64)> = stmt
        .query_map([query.as_bytes()], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    println!("kNN results:");
    for (id, d) in &rows {
        let v = items.iter().find(|(i, _)| i == id).unwrap().1;
        let hand = cosine(&query, &v);
        println!("  rowid={id} vec_distance={d:.6} hand_cosine={hand:.6}");
    }

    // Assertions
    assert_eq!(rows.len(), 3, "expected 3 rows back");
    assert_eq!(rows[0].0, 1, "row 1 should be nearest to [1,0.05,0,0]");
    assert_eq!(rows[1].0, 2, "row 2 second nearest");
    assert_eq!(rows[2].0, 3, "row 3 furthest");
    assert!(rows[0].1 < rows[1].1);
    assert!(rows[1].1 < rows[2].1);

    // Verify vec_distance_cosine function is registered
    let cos_dist: f64 = conn.query_row(
        "SELECT vec_distance_cosine(?, ?)",
        params![
            ([1.0f32, 0.0, 0.0, 0.0]).as_bytes(),
            ([0.9f32, 0.1, 0.0, 0.0]).as_bytes(),
        ],
        |r| r.get(0),
    )?;
    println!("vec_distance_cosine([1,0,0,0], [0.9,0.1,0,0]) = {cos_dist:.6}");
    let expected = cosine(&[1.0, 0.0, 0.0, 0.0], &[0.9, 0.1, 0.0, 0.0]) as f64;
    assert!(
        (cos_dist - expected).abs() < 1e-5,
        "cosine distance mismatch: {cos_dist} vs {expected}"
    );

    println!("Q1 PASS: sqlite-vec statically linked, vec0 + kNN + vec_distance_cosine all working.");
    Ok(())
}
