package com.wordweave.offline;

import java.net.URI;

final class EndpointPolicy {
    static final String HOST = "wordweave-cet-study.shiw36663.chatgpt.site";
    static URI parse(String raw) {
        URI uri = URI.create(raw);
        String path = uri.getRawPath();
        // Reject encoded separators/traversal and credentials, not just an apparent prefix.
        if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost()) || uri.getUserInfo() != null ||
            (uri.getPort() != -1 && uri.getPort() != 443) || uri.getFragment() != null || path == null ||
            !path.startsWith("/api/mobile/") || path.contains("%") || !uri.normalize().getRawPath().equals(path) || path.contains("\\")) {
            throw new IllegalArgumentException("仅允许连接词间同步服务。");
        }
        return uri;
    }
}
