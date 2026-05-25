package org.nzbhydra.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@Component
public class FrontendDeploymentValidator {

    private static final Logger logger = LoggerFactory.getLogger(FrontendDeploymentValidator.class);

    private final ConfigurableEnvironment environment;

    @Value("${ui.frontend-url:http://localhost:3000}")
    private String frontendUrl;

    @Value("${ui.cors.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}")
    private String[] allowedOrigins;

    @Value("${ui.production-mode:false}")
    private boolean productionMode;

    public FrontendDeploymentValidator(ConfigurableEnvironment environment) {
        this.environment = environment;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void validate() {
        boolean productionProfileActive = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(profile -> "prod".equalsIgnoreCase(profile) || "production".equalsIgnoreCase(profile));
        if (!productionMode && !productionProfileActive) {
            return;
        }

        List<String> errors = new ArrayList<>();
        if (!frontendUrl.startsWith("http://") && !frontendUrl.startsWith("https://")) {
            errors.add("ui.frontend-url must start with http:// or https://");
        }
        if (containsLocalAddress(frontendUrl)) {
            errors.add("ui.frontend-url must not use localhost or 127.0.0.1 in production mode");
        }

        for (String origin : allowedOrigins) {
            String trimmed = origin.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if ("*".equals(trimmed)) {
                errors.add("ui.cors.allowed-origins must not contain wildcard '*' in production mode");
            }
            if (containsLocalAddress(trimmed)) {
                errors.add("ui.cors.allowed-origins must not contain localhost or 127.0.0.1 in production mode");
            }
        }

        if (!errors.isEmpty()) {
            throw new IllegalStateException("Invalid UI deployment configuration: " + String.join("; ", errors));
        }

        logger.info("UI deployment configuration validated for frontend URL {}", frontendUrl);
    }

    private boolean containsLocalAddress(String value) {
        String lower = value.toLowerCase();
        return lower.contains("localhost") || lower.contains("127.0.0.1");
    }
}
