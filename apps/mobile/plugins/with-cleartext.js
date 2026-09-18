const { withAndroidManifest } = require("@expo/config-plugins");

/** HTTP cleartext only for the explicit local adb-reverse/debug profile. */
module.exports = function withCleartext(config) {
  return withAndroidManifest(config, (config) => {
    const applications = config.modResults.manifest.application;
    if (!Array.isArray(applications) || applications.length === 0) return config;
    applications[0].$ = applications[0].$ ?? {};
    const allow = process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT === "1";
    applications[0].$["android:usesCleartextTraffic"] = allow ? "true" : "false";
    return config;
  });
};
