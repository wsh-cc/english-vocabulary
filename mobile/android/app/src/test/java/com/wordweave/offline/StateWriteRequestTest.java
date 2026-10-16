package com.wordweave.offline;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.math.BigDecimal;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class StateWriteRequestTest {
    private static PluginCall serializedCall(Object revision) throws Exception {
        JSONObject options = new JSONObject();
        options.put("stateJson", "{\"pending\":[\"one\"]}");
        options.put("expectedRevision", revision);
        return new PluginCall(null, "WordweaveNative", "test-callback", "writeState", new JSObject(options.toString()));
    }

    @Test public void acceptsFirstWriteRevisionFromRealSerializedPluginCall() throws Exception {
        PluginCall call = serializedCall(0);
        assertTrue(call.getData().opt("expectedRevision") instanceof Integer);
        assertEquals(0, StateWriteRequest.parse(call).expectedRevision);
    }

    @Test public void acceptsSecondWriteRevisionFromRealSerializedPluginCall() throws Exception {
        PluginCall call = serializedCall(1);
        assertTrue(call.getData().opt("expectedRevision") instanceof Integer);
        assertEquals(1, StateWriteRequest.parse(call).expectedRevision);
    }

    @Test public void acceptsWholeNumericValuesAcrossJsonNumberTypes() throws Exception {
        assertEquals(1, StateWriteRequest.parse(serializedCall(1.0)).expectedRevision);
        assertEquals(2147483648L, StateWriteRequest.parse(serializedCall(2147483648L)).expectedRevision);
        assertEquals(9007199254740990L, StateWriteRequest.parse(serializedCall(9007199254740990L)).expectedRevision);
    }

    @Test public void rejectsInvalidSerializedRevisionTypesAndValues() throws Exception {
        Object[] invalid = {
            "0", "1", JSONObject.NULL, true, -1, 0.5, 1.25,
            9007199254740991L, 9007199254740992L,
            new BigDecimal("1.000000000000000000000000000001")
        };
        for (Object value : invalid) {
            PluginCall call = serializedCall(value);
            assertThrows("Invalid revision " + value, IllegalArgumentException.class, () -> StateWriteRequest.parse(call));
        }
    }

    @Test public void rejectsNonFiniteNumericRevisions() {
        // JSON itself cannot encode these values; verify the numeric boundary
        // also rejects them if supplied directly by a native Number producer.
        for (Double value : new Double[]{Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY}) {
            assertThrows(IllegalArgumentException.class, () -> StateWriteRequest.parseRevision(value));
        }
    }

    @Test public void rejectsMissingRevision() throws Exception {
        PluginCall call = new PluginCall(null, "WordweaveNative", "test-callback", "writeState", new JSObject("{\"stateJson\":\"{}\"}"));
        assertThrows(IllegalArgumentException.class, () -> StateWriteRequest.parse(call));
    }

    @Test public void rejectsMissingStatePayload() throws Exception {
        PluginCall call = new PluginCall(null, "WordweaveNative", "test-callback", "writeState", new JSObject("{\"expectedRevision\":0}"));
        assertThrows(IllegalArgumentException.class, () -> StateWriteRequest.parse(call));
    }

    @Test public void preservesPayloadAndRecoveryFlagThroughSerialization() throws Exception {
        JSONObject options = new JSONObject();
        options.put("stateJson", "{\"pending\":[\"one\"]}");
        options.put("expectedRevision", 1);
        options.put("keepRecovery", true);
        PluginCall call = new PluginCall(null, "WordweaveNative", "test-callback", "writeState", new JSObject(options.toString()));
        StateWriteRequest parsed = StateWriteRequest.parse(call);
        assertEquals("{\"pending\":[\"one\"]}", parsed.stateJson);
        assertTrue(parsed.keepRecovery);
    }
}
