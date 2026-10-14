package com.wordweave.offline;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import static org.junit.Assert.*;

public class StateStoreInstrumentedTest {
    private static final String TEST_DATABASE = "wordweave-instrumentation-test.db";
    private Context context;
    private StateStore store;
    @Before public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.deleteDatabase(TEST_DATABASE);
        store = new StateStore(context, TEST_DATABASE);
    }
    @After public void tearDown() { store.close(); context.deleteDatabase(TEST_DATABASE); }
    @Test public void staleWriteCannotOverwriteAndRecoverySurvivesReopen() throws Exception {
        assertNull(store.read().stateJson);
        assertEquals(1, store.write("{\"pending\":[\"one\"]}", 0, false));
        assertThrows(StateStore.RevisionConflict.class, () -> store.write("{\"pending\":[]}", 0, true));
        assertEquals("{\"pending\":[\"one\"]}", store.read().stateJson);
        assertEquals(2, store.write("{\"pending\":[\"one\",\"two\"]}", 1, true));
        store.close();
        store = new StateStore(context, TEST_DATABASE);
        assertEquals(2, store.read().revision);
        assertEquals("{\"pending\":[\"one\"]}", store.read().recoveryJson);
    }
    @Test public void invalidJsonNeverAdvancesRevision() throws Exception {
        store.write("{\"state\":\"original\"}", 0, false);
        assertThrows(Exception.class, () -> store.write("not json", 1, true));
        assertEquals(1, store.read().revision);
        assertEquals("{\"state\":\"original\"}", store.read().stateJson);
        assertNull(store.read().recoveryJson);
    }
    @Test public void credentialIsEncryptedAndCanBeRemoved() throws Exception {
        CredentialStore credentials = new CredentialStore(context, "wordweave-instrumentation-test-session", "wordweave-instrumentation-test-key");
        credentials.write("test-token-this-is-not-a-production-credential");
        assertEquals("test-token-this-is-not-a-production-credential", credentials.read());
        String stored = context.getSharedPreferences("wordweave-instrumentation-test-session", Context.MODE_PRIVATE).getString("credential", "");
        assertFalse(stored.contains("test-token"));
        credentials.write(null);
        assertNull(credentials.read());
    }
    @Test public void envelopeAboveCursorWindowLimitSurvivesReopen() throws Exception {
        char[] characters = new char[3 * 1024 * 1024];
        java.util.Arrays.fill(characters, 'x');
        String payload = "{\"state\":\"" + new String(characters) + "\"}";
        store.write(payload, 0, false);
        store.write("{\"state\":\"restored\"}", 1, true);
        store.close();
        store = new StateStore(context, TEST_DATABASE);
        assertEquals("{\"state\":\"restored\"}", store.read().stateJson);
        assertEquals(payload, store.read().recoveryJson);
    }
}
