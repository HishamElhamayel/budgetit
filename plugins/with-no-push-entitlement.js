/**
 * Removes the `aps-environment` entitlement that expo-notifications adds.
 *
 * That entitlement is what registers an app with APNs, and it is only needed to
 * receive *remote* push. This app never asks for a push token — src/lib/
 * notifications.ts schedules a local DAILY trigger and nothing else — so the
 * entitlement buys nothing here.
 *
 * It does cost something, though. Apple's free provisioning (a plain Apple ID
 * with no paid Developer Program membership) cannot issue a profile carrying
 * the Push Notifications capability, so Xcode refuses to sign the build at all:
 * "Personal development teams do not support the Push Notifications
 * capability." Dropping the key is the difference between the app installing on
 * a phone and not building.
 *
 * Listed *first* in app.json, which reads backwards but is what works: each
 * `withEntitlementsPlist` mod runs its own action and then delegates to the mod
 * it replaced, so the chain executes in reverse array order. Listed last, this
 * deletes a key expo-notifications has not written yet and the entitlement
 * survives — verified by prebuilding both ways.
 *
 * If a paid account ever appears and real push is wanted, delete this plugin
 * rather than working around it; the entitlement comes back on its own.
 */

const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
