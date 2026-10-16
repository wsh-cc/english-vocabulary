package com.wordweave.offline;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

@CapacitorPlugin(name = "WordweaveNative")
public class WordweaveNativePlugin extends Plugin {
    private static final int FILE_LIMIT = 4 * 1024 * 1024;
    private static final int EXPORT_LIMIT = 32 * 1024 * 1024;
    private final ExecutorService storageWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService networkWorker = Executors.newFixedThreadPool(2);
    private StateStore stateStore;
    private CredentialStore credentials;
    private TextToSpeech speech;
    private volatile Voice englishVoice;
    private volatile String speechReason = "正在初始化本机语音，请稍后重试。";
    private boolean filePickerActive;

    @Override public void load() {
        stateStore = new StateStore(getContext());
        credentials = new CredentialStore(getContext());
        getActivity().runOnUiThread(() -> {
            speech = new TextToSpeech(getContext(), status -> {
                if (status != TextToSpeech.SUCCESS) {
                    speechReason = "本机语音引擎不可用，请在系统中安装英文离线语音。";
                    return;
                }
                getActivity().runOnUiThread(this::selectEnglishVoice);
            });
        });
    }

    private void selectEnglishVoice() {
        if (speech == null) return;
        Set<Voice> voices = speech.getVoices();
        englishVoice = voices == null ? null : voices.stream()
            .filter(v -> v.getLocale().getLanguage().equals(Locale.ENGLISH.getLanguage()) && !v.isNetworkConnectionRequired())
            .filter(v -> !v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))
            .sorted(Comparator.comparing((Voice v) -> !v.getLocale().equals(Locale.US)).thenComparing(Voice::getName))
            .findFirst().orElse(null);
        if (englishVoice == null) speechReason = "未找到已安装的离线英文语音，请在系统语音设置中下载。";
        else speechReason = null;
    }

    private static JSObject result(String key, Object value) {
        JSObject object = new JSObject();
        object.put(key, value == null ? JSONObject.NULL : value);
        return object;
    }

    @PluginMethod public void readState(PluginCall call) {
        storageWorker.execute(() -> {
            try {
                StateStore.Snapshot snapshot = stateStore.read();
                JSObject value = result("stateJson", snapshot.stateJson);
                value.put("revision", snapshot.revision);
                value.put("recoveryJson", snapshot.recoveryJson == null ? JSONObject.NULL : snapshot.recoveryJson);
                call.resolve(value);
            } catch (Exception error) { call.reject("本机档案读取失败。请保留现有记录，尝试从备份恢复。", "STATE_READ", error); }
        });
    }

    @PluginMethod public void writeState(PluginCall call) {
        final StateWriteRequest input;
        try { input = StateWriteRequest.parse(call); }
        catch (IllegalArgumentException error) { call.reject(error.getMessage(), "INVALID_INPUT"); return; }
        storageWorker.execute(() -> {
            try { call.resolve(result("revision", stateStore.write(input.stateJson, input.expectedRevision, input.keepRecovery))); }
            catch (StateStore.RevisionConflict error) { call.reject(error.getMessage(), "REVISION_CONFLICT"); }
            catch (Exception error) { call.reject("本机保存失败，请保持当前答案并重试。", "STATE_WRITE", error); }
        });
    }

    @PluginMethod public void readCredential(PluginCall call) {
        storageWorker.execute(() -> {
            try { call.resolve(result("token", credentials.read())); }
            catch (Exception error) { call.reject("无法解密本机登录凭据，请重新登录。学习记录仍然保留。", "CREDENTIAL_READ"); }
        });
    }

    @PluginMethod public void writeCredential(PluginCall call) {
        String token = call.getString("token");
        storageWorker.execute(() -> {
            try { credentials.write(token); call.resolve(); }
            catch (Exception error) { call.reject("本机登录凭据保存失败，请重新登录。", "CREDENTIAL_WRITE"); }
        });
    }

    @PluginMethod public void readBackup(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (filePickerActive) { call.reject("文件选择器已打开。", "FILE_BUSY"); return; }
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
            filePickerActive = true;
            try { startActivityForResult(call, intent, "backupReadResult"); }
            catch (Exception error) { filePickerActive = false; call.reject("无法打开系统文件选择器。", "FILE_PICKER", error); }
        });
    }

    @ActivityCallback private void backupReadResult(PluginCall call, ActivityResult result) {
        filePickerActive = false;
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) { call.resolve(result("cancelled", true)); return; }
        storageWorker.execute(() -> {
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IllegalStateException("所选文件无法读取。");
                String text = decodeUtf8(readLimited(input));
                String name = "backup.json";
                try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) name = cursor.getString(0);
                }
                JSObject value = result("cancelled", false);
                value.put("text", text);
                value.put("name", name);
                call.resolve(value);
            } catch (Exception error) { call.reject("文件读取失败。请选择不超过 4 MB 的 UTF-8 JSON 文件。", "FILE_READ", error); }
        });
    }

    @PluginMethod public void writeBackup(PluginCall call) {
        String text = call.getString("text");
        String name = call.getString("fileName", "wordweave-backup.json");
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > EXPORT_LIMIT) { call.reject("本机完整备份超过 32 MB，请先检查数据后重试。", "FILE_SIZE"); return; }
        String fileName = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        getActivity().runOnUiThread(() -> {
            if (filePickerActive) { call.reject("文件选择器已打开。", "FILE_BUSY"); return; }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE, fileName);
            filePickerActive = true;
            try { startActivityForResult(call, intent, "backupWriteResult"); }
            catch (Exception error) { filePickerActive = false; call.reject("无法打开系统保存界面。", "FILE_PICKER", error); }
        });
    }

    @ActivityCallback private void backupWriteResult(PluginCall call, ActivityResult result) {
        filePickerActive = false;
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) { call.resolve(result("saved", false)); return; }
        storageWorker.execute(() -> {
            try {
                try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IllegalStateException("所选位置无法写入。");
                    output.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
                    output.flush();
                }
                call.resolve(result("saved", true));
            } catch (Exception error) { call.reject("备份保存失败，请重新选择保存位置。", "FILE_WRITE", error); }
        });
    }

    @PluginMethod public void request(PluginCall call) {
        String rawUrl = call.getString("url");
        String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        String text = call.getString("body");
        String token = call.getString("token");
        final URI uri;
        final byte[] body = text == null ? null : text.getBytes(StandardCharsets.UTF_8);
        try {
            uri = EndpointPolicy.parse(rawUrl);
            if (!(method.equals("GET") || method.equals("POST") || method.equals("DELETE"))) throw new IllegalArgumentException("不支持的请求方法。");
            if (method.equals("GET") && body != null) throw new IllegalArgumentException("GET 请求不能包含正文。");
            if (body != null && body.length > FILE_LIMIT) throw new IllegalArgumentException("同步请求超过 4 MB。");
            if (token != null && (token.length() > 4096 || token.contains("\n") || token.contains("\r"))) throw new IllegalArgumentException("登录凭据格式无效。");
        } catch (Exception error) { call.reject("同步请求无效。", "INVALID_REQUEST"); return; }
        networkWorker.execute(() -> {
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) uri.toURL().openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestMethod(method);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "Wordweave-Android/0.1.2");
                if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
                if (body != null) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    connection.setFixedLengthStreamingMode(body.length);
                    try (OutputStream stream = connection.getOutputStream()) { stream.write(body); }
                }
                int status = connection.getResponseCode();
                InputStream source = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String response = "";
                if (source != null) try (InputStream stream = source) { response = decodeUtf8(readLimited(stream)); }
                JSObject value = result("status", status);
                value.put("body", response);
                call.resolve(value);
            } catch (Exception error) { call.reject("无法连接词间服务。本机学习记录已保留，请联网后重试。", "NETWORK"); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }

    private static byte[] readLimited(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int length;
        while ((length = input.read(chunk)) != -1) {
            if (output.size() + length > FILE_LIMIT) throw new IllegalArgumentException("文件超过 4 MB。");
            output.write(chunk, 0, length);
        }
        return output.toByteArray();
    }

    private static String decodeUtf8(byte[] bytes) throws Exception {
        return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
    }

    @PluginMethod public void speechStatus(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            selectEnglishVoice();
            JSObject value = result("available", englishVoice != null);
            if (speechReason != null) value.put("reason", speechReason);
            call.resolve(value);
        });
    }

    @PluginMethod public void speak(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty() || text.length() > 4000) { call.reject("朗读内容为空或过长。", "SPEECH_INPUT"); return; }
        getActivity().runOnUiThread(() -> {
            selectEnglishVoice();
            if (englishVoice == null || speech == null) { call.reject(speechReason, "SPEECH_UNAVAILABLE"); return; }
            if (speech.setVoice(englishVoice) != TextToSpeech.SUCCESS) { call.reject("离线英文语音尚未准备好。", "SPEECH_UNAVAILABLE"); return; }
            speech.setSpeechRate(0.85f);
            int status = speech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "wordweave");
            if (status == TextToSpeech.ERROR) call.reject("语音播放失败，请检查系统语音设置。", "SPEECH_FAILED");
            else call.resolve();
        });
    }
    @PluginMethod public void stopSpeech(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (speech != null) speech.stop(); call.resolve(); });
    }
    @PluginMethod public void openSpeechSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { getActivity().startActivity(new Intent("com.android.settings.TTS_SETTINGS")); call.resolve(); }
            catch (Exception first) {
                try { getActivity().startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); call.resolve(); }
                catch (Exception error) { call.reject("无法打开系统语音设置，请在手机设置中搜索文字转语音。", "SPEECH_SETTINGS"); }
            }
        });
    }

    @Override protected void handleOnPause() {
        if (speech != null) speech.stop();
        super.handleOnPause();
    }
    @Override protected void handleOnDestroy() {
        if (speech != null) { speech.stop(); speech.shutdown(); }
        storageWorker.execute(stateStore::close);
        storageWorker.shutdown();
        networkWorker.shutdown();
        // Queued storage writes own the helper until complete; close on that worker.
        super.handleOnDestroy();
    }
}
