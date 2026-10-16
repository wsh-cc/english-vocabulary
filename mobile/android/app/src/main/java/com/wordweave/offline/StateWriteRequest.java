package com.wordweave.offline;

import com.getcapacitor.PluginCall;
import java.math.BigDecimal;

/** The JavaScript-to-native persistence request boundary. */
final class StateWriteRequest {
    private static final BigDecimal MAX_SAFE_INTEGER = new BigDecimal("9007199254740991");
    final String stateJson;
    final long expectedRevision;
    final boolean keepRecovery;

    private StateWriteRequest(String stateJson, long expectedRevision, boolean keepRecovery) {
        this.stateJson = stateJson;
        this.expectedRevision = expectedRevision;
        this.keepRecovery = keepRecovery;
    }

    static StateWriteRequest parse(PluginCall call) {
        String stateJson = call.getString("stateJson");
        if (stateJson == null) throw new IllegalArgumentException("缺少本机学习档案。");
        long revision = parseRevision(call.getData().opt("expectedRevision"));
        return new StateWriteRequest(stateJson, revision, Boolean.TRUE.equals(call.getBoolean("keepRecovery", false)));
    }

    static long parseRevision(Object value) {
        // JSON deserializes small JavaScript integers as Integer, not Long.
        // Validate the numeric value without coercing strings or truncating fractions.
        if (value instanceof Number) {
            try {
                BigDecimal revision = new BigDecimal(value.toString());
                // A successful save increments the revision, so leave that increment safe.
                if (revision.signum() >= 0 && revision.compareTo(MAX_SAFE_INTEGER) < 0) return revision.longValueExact();
            } catch (NumberFormatException | ArithmeticException ignored) {
                // NaN, infinity and non-integral values are invalid bridge inputs.
            }
        }
        throw new IllegalArgumentException("本机修订号必须是可递增的非负安全整数，请重新载入记录后重试。");
    }
}
