// SQLite adapter for route regression tests. D1.batch is a single transaction.
export function isolatedD1(db, beforeStateWrite = () => {}) {
  return {
    prepare(sql) {
      let values = [];
      const execute = () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } });
      return {
        sql, execute,
        bind(...args) { values = args; return this; },
        async first() { return db.prepare(sql).get(...values) ?? null; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
        async run() { if (sql.startsWith('UPDATE learner_state')) beforeStateWrite(); return execute(); },
      };
    },
    async batch(statements) {
      // A concurrent writer commits before the transaction takes its CAS lock.
      if (statements.some(statement => statement.sql.startsWith('UPDATE learner_state'))) beforeStateWrite();
      db.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
