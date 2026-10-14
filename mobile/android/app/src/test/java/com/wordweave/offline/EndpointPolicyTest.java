package com.wordweave.offline;

import org.junit.Test;
import static org.junit.Assert.*;

public class EndpointPolicyTest {
    @Test public void permitsOnlyMobileServiceOverHttps() {
        assertEquals("/api/mobile/sync", EndpointPolicy.parse("https://wordweave-cet-study.shiw36663.chatgpt.site/api/mobile/sync").getPath());
        assertEquals(443, EndpointPolicy.parse("https://wordweave-cet-study.shiw36663.chatgpt.site:443/api/mobile/bootstrap").getPort());
    }
    @Test public void rejectsAlternateOriginCredentialsAndTraversal() {
        String[] urls = {
            "http://wordweave-cet-study.shiw36663.chatgpt.site/api/mobile/sync",
            "https://attacker.example/api/mobile/sync",
            "https://wordweave-cet-study.shiw36663.chatgpt.site.attacker.example/api/mobile/sync",
            "https://user:pass@wordweave-cet-study.shiw36663.chatgpt.site/api/mobile/sync",
            "https://wordweave-cet-study.shiw36663.chatgpt.site:444/api/mobile/sync",
            "https://wordweave-cet-study.shiw36663.chatgpt.site/api/mobile/../../admin",
            "https://wordweave-cet-study.shiw36663.chatgpt.site/api/mobile/%2e%2e/admin",
            "https://wordweave-cet-study.shiw36663.chatgpt.site/api/state",
            "https://wordweave-cet-study.shiw36663.chatgpt.site/api/mobile/auth#fragment"
        };
        for (String url : urls) assertThrows(url, IllegalArgumentException.class, () -> EndpointPolicy.parse(url));
    }
}
