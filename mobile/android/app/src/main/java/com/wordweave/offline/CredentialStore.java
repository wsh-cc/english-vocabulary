package com.wordweave.offline;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Bearer credentials never enter SQLite, Web Storage, logs or exported backups. */
final class CredentialStore {
    private final String alias;
    private final SharedPreferences preferences;
    CredentialStore(Context context) {
        this(context, "wordweave-secure-session", "wordweave-mobile-session-v1");
    }
    CredentialStore(Context context, String preferenceName, String alias) {
        preferences = context.getSharedPreferences(preferenceName, Context.MODE_PRIVATE);
        this.alias = alias;
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(alias, null);
    }
    synchronized String read() throws Exception {
        String value = preferences.getString("credential", null);
        if (value == null) return null;
        JSONObject sealed = new JSONObject(value);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(sealed.getString("iv"), Base64.NO_WRAP)));
        cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.decode(sealed.getString("ciphertext"), Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    synchronized void write(String token) throws Exception {
        if (token == null) {
            if (!preferences.edit().remove("credential").commit()) throw new IllegalStateException("无法移除本机登录凭据。");
            return;
        }
        if (token.length() == 0 || token.length() > 4096 || token.contains("\n") || token.contains("\r")) throw new IllegalArgumentException("登录凭据格式无效。");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
        byte[] ciphertext = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        JSONObject sealed = new JSONObject();
        sealed.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        sealed.put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP));
        if (!preferences.edit().putString("credential", sealed.toString()).commit()) throw new IllegalStateException("登录凭据保存失败。");
    }
}
