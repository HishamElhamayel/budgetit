/**
 * Turns off ENABLE_USER_SCRIPT_SANDBOXING, which the Expo template sets to YES.
 *
 * With it on, Xcode runs each script phase in a sandbox that may only write to
 * paths the phase declares as outputs. React Native's `react-native-xcode.sh`
 * does not play along: on a *device* Debug build it writes the dev server's
 * address into the app bundle (`echo "$IP" > "$DEST/ip.txt"`, line 27) without
 * declaring it, so the sandbox denies the write and the phase exits non-zero.
 *
 * Xcode reports that as "Command PhaseScriptExecution failed with a nonzero
 * exit code" and nothing else — the actual `ip.txt: Operation not permitted` is
 * only visible in the .xcactivitylog under DerivedData, which is what makes
 * this worth a comment rather than a one-line setting.
 *
 * Only device Debug builds hit it. The simulator path skips the ip.txt block
 * entirely, so a project that builds fine in the simulator still fails the
 * moment it targets a phone.
 *
 * Disabling the sandbox is what Expo's own "Configuring your Xcode project"
 * guide instructs for this exact reason. It relaxes a build-time protection,
 * not anything about the shipped app.
 */

const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withScriptSandboxingOff(config) {
  return withXcodeProject(config, (cfg) => {
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(configurations)) {
      // The section interleaves entries with `<key>_comment` strings; only the
      // objects carry buildSettings.
      const buildSettings = configurations[key]?.buildSettings;
      if (buildSettings) {
        buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
      }
    }

    return cfg;
  });
};
