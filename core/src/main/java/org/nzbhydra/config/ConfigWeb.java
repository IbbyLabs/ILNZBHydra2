package org.nzbhydra.config;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.servlet.http.HttpSession;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.nzbhydra.config.sensitive.HiddenInUI;
import org.nzbhydra.config.sensitive.SensitiveData;
import org.nzbhydra.GenericResponse;
import org.nzbhydra.config.safeconfig.SafeConfig;
import org.nzbhydra.config.validation.BaseConfigValidator;
import org.nzbhydra.config.validation.ConfigValidationResult;
import org.nzbhydra.externaltools.ExternalToolsSyncService;
import org.nzbhydra.springnative.ReflectionMarker;
import org.nzbhydra.web.UrlCalculator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.PropertySource;
import org.springframework.http.MediaType;
import org.springframework.security.access.annotation.Secured;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.WildcardType;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

@RestController
public class ConfigWeb {

    private static final Logger logger = LoggerFactory.getLogger(ConfigWeb.class);

    private static final Map<String, String> FIELD_DESCRIPTIONS = createFieldDescriptions();
    private static final Map<String, NumberRange> FIELD_NUMBER_RANGES = createNumberRanges();

    @Autowired
    private ConfigProvider configProvider;
    @Autowired
    private ConfigurableEnvironment environment;
    @Autowired
    private FileSystemBrowser fileSystemBrowser;
    @Autowired
    private UrlCalculator urlCalculator;
    @Autowired
    private BaseConfigValidator baseConfigValidator;
    @Autowired
    private BaseConfigHandler baseConfigHandler;
    @Autowired
    private ExternalToolsSyncService externalToolsSyncService;
    @Autowired
    private IndexerConfigService indexerConfigService;
    private final ConfigReaderWriter configReaderWriter = new ConfigReaderWriter();

    @Secured({"ROLE_ADMIN"})
    @RequestMapping(value = "/internalapi/config", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    public BaseConfig getConfig(HttpSession session) throws IOException {
        final BaseConfig baseConfig = configReaderWriter.loadSavedConfig();
        return baseConfigValidator.updateAfterLoading(baseConfig);
    }

    @Secured({"ROLE_ADMIN"})
    @RequestMapping(value = "/internalapi/config", method = RequestMethod.PUT, consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ConfigValidationResult setConfig(@RequestBody BaseConfig newConfig) throws IOException {
        for (PropertySource<?> source : environment.getPropertySources()) {
            Set<String> propertyNames = new HashSet<>();
            if (source.getSource() instanceof Properties) {
                propertyNames = ((Properties) source.getSource()).stringPropertyNames();
            } else if (source.getSource() instanceof LinkedHashMap) {
                propertyNames = ((LinkedHashMap<?, ?>) source.getSource()).keySet().stream().map(String::valueOf).collect(java.util.stream.Collectors.toSet());
            }
            boolean contains = propertyNames.contains("main.externalUrl");
            if (contains) {
                logger.info(source.toString());
            }
        }

        logger.info("Received new config");
        BaseConfig oldConfig = configProvider.getBaseConfig();
        newConfig = baseConfigValidator.prepareForSaving(oldConfig, newConfig);
        ConfigValidationResult result = baseConfigValidator.validateConfig(oldConfig, newConfig, newConfig);
        if (result.isOk()) {
            // Handle indexer renames and deletions in a single transaction
            indexerConfigService.handleIndexerConfigChanges(newConfig);

            // Detect which indexers changed before replacing config
            Set<String> changedIndexers = externalToolsSyncService.detectChangedIndexers(
                    oldConfig.getIndexers(),
                    newConfig.getIndexers()
            );

            baseConfigHandler.replace(newConfig);
            baseConfigHandler.save(true);
            result.setNewConfig(configProvider.getBaseConfig());

            // Sync to external tools if enabled and indexers changed
            if (configProvider.getBaseConfig().getExternalTools().isSyncOnConfigChange() && !changedIndexers.isEmpty()) {
                logger.info("Indexers changed, syncing to external tools");
                try {
                    ExternalToolsSyncService.SyncResult syncResult = externalToolsSyncService.syncTools(changedIndexers);
                    logger.info("External tools sync completed: {} successful, {} failed",
                            syncResult.getSuccessCount(), syncResult.getFailureCount());
                } catch (Exception e) {
                    logger.error("Error syncing to external tools", e);
                }
            }
        }
        return result;
    }

    @Secured({"ROLE_ADMIN"})
    @RequestMapping(value = "/internalapi/config/reload", method = RequestMethod.GET)
    public GenericResponse reloadConfig() throws IOException {
        logger.info("Reloading config from file");
        try {
            baseConfigHandler.load();
        } catch (IOException e) {
            return new GenericResponse(false, e.getMessage());
        }
        return GenericResponse.ok();
    }

    @Secured({"ROLE_USER"})
    @RequestMapping(value = "/internalapi/config/safe", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    public SafeConfig getSafeConfig() {
        return new SafeConfig(configProvider.getBaseConfig());
    }

    @Secured({"ROLE_USER"})
    @RequestMapping(value = "/internalapi/config/folderlisting", method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    public FileSystemBrowser.FileSystemEntry getDirectoryListing(@RequestBody FileSystemBrowser.DirectoryListingRequest request) {
        return fileSystemBrowser.getDirectoryListing(request);
    }

    @Secured({"ROLE_ADMIN"})
    @RequestMapping(value = "/internalapi/config/apiHelp", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    public ApiHelpResponse getApiHelp(HttpSession session) throws IOException {
        UriComponentsBuilder requestBasedUriBuilder = urlCalculator.getRequestBasedUriBuilder();
        String newznabApi = requestBasedUriBuilder.cloneBuilder().toUriString();
        String torznabApi = requestBasedUriBuilder.cloneBuilder().path("/torznab").toUriString();
        String apikey = configProvider.getBaseConfig().getMain().getApiKey();
        return new ApiHelpResponse(newznabApi, torznabApi, apikey);
    }

    @Secured({"ROLE_ADMIN"})
    @RequestMapping(value = "/internalapi/config/schema", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    public ConfigSchemaResponse getConfigSchema() {
        ConfigFieldSchema rootSchema = buildSchema("config", "", BaseConfig.class, new LinkedHashSet<>(), null);
        return new ConfigSchemaResponse(rootSchema.getChildren(), buildTabSections(), buildQuickPathsByTab());
    }

    private LinkedHashMap<String, List<String>> buildTabSections() {
        LinkedHashMap<String, List<String>> sections = new LinkedHashMap<>();
        sections.put("main", Arrays.asList("main", "auth", "searching", "categoriesConfig", "categories", "downloading", "externalTools", "indexers", "notificationConfig", "notifications", "emby"));
        sections.put("auth", Collections.singletonList("auth"));
        sections.put("searching", Collections.singletonList("searching"));
        sections.put("categories", Arrays.asList("categoriesConfig", "categories"));
        sections.put("downloading", Collections.singletonList("downloading"));
        sections.put("externalTools", Collections.singletonList("externalTools"));
        sections.put("indexers", Collections.singletonList("indexers"));
        sections.put("notifications", Arrays.asList("notificationConfig", "notifications"));
        return sections;
    }

        private LinkedHashMap<String, List<String>> buildQuickPathsByTab() {
        LinkedHashMap<String, List<String>> quickPaths = new LinkedHashMap<>();
        quickPaths.put("main", Arrays.asList(
            "main.host",
            "main.port",
            "main.ssl",
            "main.verifySsl",
            "main.backupEveryXDays",
            "main.keepHistory",
            "searching.timeout",
            "downloading.nzbAccessType",
            "notificationConfig.displayNotifications",
            "externalTools.syncOnConfigChange"
        ));
        quickPaths.put("auth", Arrays.asList(
            "auth.authType",
            "auth.rememberUsers",
            "auth.rememberMeValidityDays",
            "auth.restrictSearch",
            "auth.restrictStats",
            "auth.restrictAdmin",
            "auth.allowApiStats"
        ));
        quickPaths.put("searching", Arrays.asList(
            "searching.timeout",
            "searching.historyForSearching",
            "searching.keepSearchResultsForDays",
            "searching.ignorePassworded",
            "searching.sendTorznabCategories",
            "searching.generateQueries",
            "searching.idFallbackToQueryGeneration"
        ));
        quickPaths.put("categories", Arrays.asList(
            "categoriesConfig.enableCategorySizes",
            "categoriesConfig.defaultCategory",
            "categoriesConfig.overwriteNaWithSearchCategory"
        ));
        quickPaths.put("downloading", Arrays.asList(
            "downloading.nzbAccessType",
            "downloading.sendMagnetLinks",
            "downloading.updateStatuses",
            "downloading.showDownloaderStatus",
            "downloading.saveNzbsTo",
            "downloading.saveTorrentsTo"
        ));
        quickPaths.put("externalTools", Arrays.asList(
            "externalTools.syncOnConfigChange"
        ));
        quickPaths.put("indexers", Arrays.asList(
            "searching.generateQueries",
            "searching.ignoreLoadLimitingForInternalSearches",
            "searching.ignoreLoadLimitingForConcreteApiSearches"
        ));
        quickPaths.put("notifications", Arrays.asList(
            "notificationConfig.appriseType",
            "notificationConfig.displayNotifications",
            "notificationConfig.displayNotificationsMax"
        ));
        return quickPaths;
        }

        private ConfigFieldSchema buildSchema(String key, String path, Type type, Set<Class<?>> recursionGuard, Field sourceField) {
        Class<?> rawClass = getRawClass(type);
        String kind = getKind(rawClass);
        NumberRange range = FIELD_NUMBER_RANGES.get(path);

        ConfigFieldSchema schema = new ConfigFieldSchema();
        schema.setKey(key);
        schema.setPath(path);
        schema.setLabel(toLabel(key));
        schema.setDescription(FIELD_DESCRIPTIONS.getOrDefault(path, ""));
        schema.setKind(kind);
        schema.setNullable(!rawClass.isPrimitive());
        schema.setControl(getControl(kind, sourceField));
        schema.setRestartRequired(sourceField != null && sourceField.getAnnotation(RestartRequired.class) != null);
        schema.setSensitive(sourceField != null && sourceField.getAnnotation(SensitiveData.class) != null);
        schema.setMin(range != null ? range.min() : null);
        schema.setMax(range != null ? range.max() : null);
        schema.setEnumValues(Collections.emptyList());
        schema.setChildren(Collections.emptyList());
        schema.setItem(null);

        if (rawClass.isEnum()) {
            schema.setEnumValues(Arrays.stream(rawClass.getEnumConstants()).map(Object::toString).toList());
            return schema;
        }

        if ("array".equals(kind)) {
            Type itemType = resolveCollectionItemType(type, rawClass);
            schema.setItem(buildSchema("item", path.isEmpty() ? "item" : path + "[]", itemType, recursionGuard, null));
            return schema;
        }

        if (!"object".equals(kind) || isJdkType(rawClass)) {
            return schema;
        }

        if (recursionGuard.contains(rawClass)) {
            return schema;
        }
        recursionGuard.add(rawClass);

        List<ConfigFieldSchema> children = new ArrayList<>();
        for (Field field : rawClass.getDeclaredFields()) {
            if (Modifier.isStatic(field.getModifiers()) || Modifier.isTransient(field.getModifiers())) {
                continue;
            }
            if (field.getAnnotation(JsonIgnore.class) != null || field.getAnnotation(HiddenInUI.class) != null) {
                continue;
            }

            String fieldName = resolveFieldName(field);
            String fieldPath = path.isEmpty() ? fieldName : path + "." + fieldName;
            children.add(buildSchema(fieldName, fieldPath, field.getGenericType(), recursionGuard, field));
        }
        recursionGuard.remove(rawClass);
        schema.setChildren(children);
        return schema;
    }

    private String getControl(String kind, Field sourceField) {
        if (sourceField != null && sourceField.getAnnotation(SensitiveData.class) != null) {
            return "password";
        }
        if ("boolean".equals(kind)) {
            return "toggle";
        }
        if ("enum".equals(kind)) {
            return "select";
        }
        if ("number".equals(kind)) {
            return "number";
        }
        if ("string".equals(kind)) {
            return "text";
        }
        if ("array".equals(kind)) {
            return "list";
        }
        return "group";
    }

    private String resolveFieldName(Field field) {
        JsonProperty jsonProperty = field.getAnnotation(JsonProperty.class);
        if (jsonProperty != null) {
            String value = jsonProperty.value();
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return field.getName();
    }

    private Type resolveCollectionItemType(Type type, Class<?> rawClass) {
        if (rawClass.isArray()) {
            return rawClass.getComponentType();
        }
        if (type instanceof ParameterizedType parameterizedType) {
            Type[] arguments = parameterizedType.getActualTypeArguments();
            if (arguments.length > 0) {
                return arguments[0];
            }
        }
        return String.class;
    }

    private Class<?> getRawClass(Type type) {
        if (type instanceof Class<?>) {
            return (Class<?>) type;
        }
        if (type instanceof ParameterizedType parameterizedType) {
            return getRawClass(parameterizedType.getRawType());
        }
        if (type instanceof WildcardType wildcardType) {
            Type[] upperBounds = wildcardType.getUpperBounds();
            if (upperBounds.length > 0) {
                return getRawClass(upperBounds[0]);
            }
        }
        return Object.class;
    }

    private String getKind(Class<?> type) {
        if (type.isArray() || java.util.Collection.class.isAssignableFrom(type)) {
            return "array";
        }
        if (type.isEnum()) {
            return "enum";
        }
        if (type == boolean.class || type == Boolean.class) {
            return "boolean";
        }
        if (type.isPrimitive() || Number.class.isAssignableFrom(type)) {
            return "number";
        }
        if (CharSequence.class.isAssignableFrom(type)) {
            return "string";
        }
        if (Map.class.isAssignableFrom(type)) {
            return "object";
        }
        return "object";
    }

    private boolean isJdkType(Class<?> type) {
        Package pkg = type.getPackage();
        if (pkg == null) {
            return false;
        }
        String name = pkg.getName();
        return name.startsWith("java.") || name.startsWith("javax.") || name.startsWith("jakarta.");
    }

    private String toLabel(String key) {
        if (key == null || key.isBlank()) {
            return "Setting";
        }
        String normalized = key.replaceAll("([a-z0-9])([A-Z])", "$1 $2").replace('_', ' ').trim();
        return Character.toUpperCase(normalized.charAt(0)) + normalized.substring(1);
    }

    private static Map<String, String> createFieldDescriptions() {
        Map<String, String> descriptions = new LinkedHashMap<>();
        descriptions.put("main.host", "Network host NZBHydra listens on.");
        descriptions.put("main.port", "Port used by NZBHydra web interface.");
        descriptions.put("main.ssl", "Enable HTTPS for the web interface.");
        descriptions.put("main.verifySsl", "Verify SSL certificates for outgoing connections.");
        descriptions.put("main.backupEveryXDays", "Run automatic backups every X days.");
        descriptions.put("main.keepHistory", "Store search and download history.");
        descriptions.put("auth.authType", "Select how users authenticate.");
        descriptions.put("auth.rememberUsers", "Keep users logged in across browser sessions.");
        descriptions.put("auth.rememberMeValidityDays", "Number of days remember-me logins stay active.");
        descriptions.put("auth.restrictSearch", "Require authentication to use search.");
        descriptions.put("auth.restrictStats", "Require authentication to view statistics.");
        descriptions.put("auth.restrictAdmin", "Restrict admin pages to authorized users.");
        descriptions.put("auth.allowApiStats", "Allow API clients to access statistics endpoints.");
        descriptions.put("searching.timeout", "Timeout in seconds for indexer requests.");
        descriptions.put("searching.historyForSearching", "Number of recent searches shown in suggestions.");
        descriptions.put("searching.keepSearchResultsForDays", "Days to keep cached search results.");
        descriptions.put("searching.ignorePassworded", "Skip password-protected releases in results.");
        descriptions.put("searching.sendTorznabCategories", "Include categories in Torznab responses.");
        descriptions.put("searching.generateQueries", "Control when identifier lookups fall back to generated query text.");
        descriptions.put("searching.idFallbackToQueryGeneration", "Fallback behavior for ID-based search misses.");
        descriptions.put("categoriesConfig.enableCategorySizes", "Show estimated category size in category views.");
        descriptions.put("categoriesConfig.defaultCategory", "Default category selected in the search UI.");
        descriptions.put("categoriesConfig.overwriteNaWithSearchCategory", "Prefer selected search category when result has no category.");
        descriptions.put("downloading.nzbAccessType", "How NZB downloads are served to clients.");
        descriptions.put("downloading.sendMagnetLinks", "Send magnet links to configured downloaders.");
        descriptions.put("downloading.updateStatuses", "Refresh downloader status information automatically.");
        descriptions.put("downloading.showDownloaderStatus", "Show downloader health in the UI.");
        descriptions.put("downloading.saveNzbsTo", "Optional folder path to save NZB files.");
        descriptions.put("downloading.saveTorrentsTo", "Optional folder path to save torrent files.");
        descriptions.put("externalTools.syncOnConfigChange", "Automatically sync external tools when indexer config changes.");
        descriptions.put("notificationConfig.appriseType", "Notification backend mode.");
        descriptions.put("notificationConfig.displayNotifications", "Show notifications in the UI.");
        descriptions.put("notificationConfig.displayNotificationsMax", "Maximum number of notifications shown in UI at once.");
        return descriptions;
    }

    private static Map<String, NumberRange> createNumberRanges() {
        Map<String, NumberRange> ranges = new LinkedHashMap<>();
        ranges.put("main.port", new NumberRange(1.0, 65535.0));
        ranges.put("auth.rememberMeValidityDays", new NumberRange(0.0, 3650.0));
        ranges.put("searching.timeout", new NumberRange(1.0, 300.0));
        ranges.put("searching.historyForSearching", new NumberRange(1.0, 200.0));
        ranges.put("searching.keepSearchResultsForDays", new NumberRange(0.0, 365.0));
        ranges.put("main.backupEveryXDays", new NumberRange(1.0, 365.0));
        ranges.put("notificationConfig.displayNotificationsMax", new NumberRange(1.0, 1000.0));
        return ranges;
    }

    @Data
@ReflectionMarker
    @AllArgsConstructor
    @NoArgsConstructor
    private static class ApiHelpResponse {
        private String newznabApi;
        private String torznabApi;
        private String apiKey;
    }

    @Data
    @ReflectionMarker
    @AllArgsConstructor
    @NoArgsConstructor
    private static class ConfigSchemaResponse {
        private List<ConfigFieldSchema> sections;
        private LinkedHashMap<String, List<String>> tabSections;
        private LinkedHashMap<String, List<String>> quickPathsByTab;
    }

    @Data
    @ReflectionMarker
    @AllArgsConstructor
    @NoArgsConstructor
    private static class ConfigFieldSchema {
        private String key;
        private String path;
        private String label;
        private String description;
        private String kind;
        private String control;
        private boolean nullable;
        private boolean restartRequired;
        private boolean sensitive;
        private Double min;
        private Double max;
        private List<String> enumValues;
        private List<ConfigFieldSchema> children;
        private ConfigFieldSchema item;
    }

    private record NumberRange(Double min, Double max) {
    }


}
