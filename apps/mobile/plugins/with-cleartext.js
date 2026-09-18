const { withAndroidManifest } = require("@expo/config-plugins");

/** Local development APKs talk to 127.0.0.1 over adb reverse. No new npm dependency. */
module.exports = function withCleartext(config) {
  return withAndroidManifest(config, (config) => {
    const applications = config.modResults.manifest.application;
    if (!Array.isArray(applications) || applications.length === 0) return config;
    applications[0].$ = applications[0].$ ?? {};
    applications[0].$["android:usesCleartextTraffic"] = "true";
    return config;
  });
};
