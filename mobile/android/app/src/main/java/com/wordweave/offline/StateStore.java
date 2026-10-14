package com.wordweave.offline;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteStatement;
import org.json.JSONException;
import org.json.JSONObject;

/** One transaction persists the entire account envelope and operation queue. */
final class StateStore extends SQLiteOpenHelper {
    private static final long MAX_JS_INTEGER = 9007199254740991L;
    static final class Snapshot {
        final String stateJson, recoveryJson;
        final long revision;
        Snapshot(String stateJson, long revision, String recoveryJson) {
            this.stateJson = stateJson;
            this.revision = revision;
            this.recoveryJson = recoveryJson;
        }
    }
    static final class RevisionConflict extends IllegalStateException {
        RevisionConflict() { super("本机记录已变化，请重新加载后重试。"); }
    }

    StateStore(Context context) {
        this(context, "wordweave-state-v1.db");
    }
    StateStore(Context context, String databaseName) {
        super(context, databaseName, null, 1, db -> {
            // Android's default corruption handler deletes the damaged database.
            // Preserve it so a failed read can never become a silent empty account.
            throw new SQLiteDatabaseCorruptException("本机档案损坏，原文件已保留，请从备份恢复。");
        });
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.execSQL("PRAGMA synchronous=FULL");
    }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE account_envelope (id INTEGER PRIMARY KEY CHECK(id=1), state_json TEXT, revision INTEGER NOT NULL CHECK(revision>=0), recovery_json TEXT)");
        db.execSQL("INSERT INTO account_envelope(id,revision) VALUES(1,0)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("不支持此数据版本，请先保留备份。");
    }
    @Override public void onDowngrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("不能用旧版本打开此学习档案。");
    }

    synchronized Snapshot read() throws JSONException {
        SQLiteDatabase db = getReadableDatabase();
        db.beginTransactionNonExclusive();
        try {
            Snapshot snapshot = readFrom(db);
            db.setTransactionSuccessful();
            return snapshot;
        } finally {
            db.endTransaction();
        }
    }
    private Snapshot readFrom(SQLiteDatabase db) throws JSONException {
        try (Cursor row = db.rawQuery("SELECT revision FROM account_envelope WHERE id=1", null)) {
            if (!row.moveToFirst()) throw new IllegalStateException("本机学习档案损坏，请保留备份后恢复。");
            long revision = row.getLong(0);
            // A whole envelope can exceed Android's default 2 MB CursorWindow.
            // Native scalar statements return TEXT without putting it in that window.
            String state = readText(db, "state_json");
            String recovery = readText(db, "recovery_json");
            if (revision < 0 || revision > MAX_JS_INTEGER) throw new IllegalStateException("本机档案修订号无效。");
            if (state != null) new JSONObject(state);
            if (recovery != null) new JSONObject(recovery);
            return new Snapshot(state, revision, recovery);
        }
    }
    private static String readText(SQLiteDatabase db, String column) {
        try (SQLiteStatement statement = db.compileStatement("SELECT " + column + " FROM account_envelope WHERE id=1")) {
            return statement.simpleQueryForString();
        }
    }
    synchronized long write(String stateJson, long expectedRevision, boolean keepRecovery) throws JSONException {
        new JSONObject(stateJson);
        if (expectedRevision < 0 || expectedRevision >= MAX_JS_INTEGER) throw new IllegalArgumentException("无效的本机修订号。");
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            Snapshot previous = readFrom(db);
            if (previous.revision != expectedRevision) throw new RevisionConflict();
            ContentValues values = new ContentValues();
            values.put("state_json", stateJson);
            values.put("revision", expectedRevision + 1);
            if (keepRecovery) {
                if (previous.stateJson == null) values.putNull("recovery_json");
                else values.put("recovery_json", previous.stateJson);
            }
            if (db.update("account_envelope", values, "id=1 AND revision=?", new String[]{Long.toString(expectedRevision)}) != 1) throw new RevisionConflict();
            db.setTransactionSuccessful();
            return expectedRevision + 1;
        } finally {
            db.endTransaction();
        }
    }
}
